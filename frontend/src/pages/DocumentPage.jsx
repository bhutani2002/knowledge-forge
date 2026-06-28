import React, { useEffect, useState } from 'react';
import { useStore, api } from '../store';
import { useTranslation } from 'react-i18next';
import { Box, Typography, Divider, Button } from '@mui/material';
import DocumentUpload from '../components/DocumentUpload';

const DocumentPage = () => {
  const { t } = useTranslation();
  const { documents, activeWorkspace, fetchDocuments, isAuthenticated } = useStore();
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [docDetails, setDocDetails] = useState(null);

  useEffect(() => {
    if (activeWorkspace && (activeWorkspace.id === '00000000-0000-0000-0000-000000000000' || isAuthenticated)) {
      fetchDocuments();
    }
  }, [activeWorkspace, isAuthenticated]);

  useEffect(() => {
    let active = true;
    let timerId;

    const poll = async () => {
      const hasProcessing = useStore.getState().documents.some(
        doc => doc.status?.toUpperCase() === 'PROCESSING' || doc.status?.toUpperCase() === 'PENDING'
      );
      if (!hasProcessing) return;

      try {
        await fetchDocuments();
      } catch (err) {
        console.error("Error polling document status:", err);
      }

      if (active) {
        timerId = setTimeout(poll, 3000);
      }
    };

    const hasProcessing = documents.some(
      doc => doc.status?.toUpperCase() === 'PROCESSING' || doc.status?.toUpperCase() === 'PENDING'
    );
    if (hasProcessing) {
      timerId = setTimeout(poll, 3000);
    }

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [documents, fetchDocuments]);

  const handleDocClick = async (doc) => {
    setSelectedDoc(doc);
    setDrawerOpen(true);
    setLoadingSummary(true);
    setDocDetails(null);
    
    try {
      const res = await api.get(`/api/docs/analyze?docId=${doc.id}`);
      setDocDetails(res.data);
    } catch (err) {
      console.error("Failed to analyze document", err);
      setDocDetails({
        summary: "General document uploaded. AI analysis failed or took too long to generate.",
        entities: ["Workplace", "Document", "Info"],
        topics: ["General Information"]
      });
    } finally {
      setLoadingSummary(false);
    }
  };

  const getStatusDotColor = (status) => {
    switch (status?.toUpperCase()) {
      case 'INDEXED': return '#22c55e';      // Green
      case 'PROCESSING': return '#eab308';   // Yellow
      case 'FAILED': return '#ef4444';       // Red
      default: return '#78716c';
    }
  };

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', width: '100%', p: 3, pt: 4, position: 'relative' }}>
      <Typography 
        variant="h2" 
        sx={{ 
          fontSize: '24px', 
          fontWeight: 600, 
          color: 'text.primary',
          mb: 1,
          fontFamily: 'Inter, sans-serif'
        }}
      >
        {t('documents')}
      </Typography>
      <Typography variant="body1" sx={{ color: 'text.secondary', fontSize: '13px', mb: 4 }}>
        {t('documents_subtitle')}
      </Typography>

      {/* Dashed upload area */}
      <Box sx={{ mb: 5 }}>
        <DocumentUpload onUploadSuccess={fetchDocuments} />
      </Box>

      {/* Documents List View Table */}
      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '6px', overflow: 'hidden' }}>
        <Box 
          sx={{ 
            display: 'grid', 
            gridTemplateColumns: '3fr 1.5fr 1fr', 
            px: 2, 
            py: 1.5, 
            bgcolor: 'primary.main',
            borderBottom: '1px solid',
            borderColor: 'primary.main'
          }}
        >
          <Typography variant="caption" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '11px', letterSpacing: '0.05em' }}>{t('name_header').toUpperCase()}</Typography>
          <Typography variant="caption" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '11px', letterSpacing: '0.05em' }}>{t('uploaded_by_header').toUpperCase()}</Typography>
          <Typography variant="caption" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '11px', letterSpacing: '0.05em' }}>{t('status_header').toUpperCase()}</Typography>
        </Box>

        <Box sx={{ minHeight: 120 }}>
          {documents.map((doc) => (
            <Box
              key={doc.id}
              onClick={() => handleDocClick(doc)}
              sx={{
                display: 'grid',
                gridTemplateColumns: '3fr 1.5fr 1fr',
                px: 2,
                py: 2,
                borderBottom: '1px solid',
                borderColor: 'divider',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
                bgcolor: selectedDoc?.id === doc.id ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
                '&:last-child': { borderBottom: 'none' }
              }}
            >
              <Typography 
                variant="body2" 
                sx={{ 
                  color: 'text.primary', 
                  fontSize: '13px', 
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 500,
                  noWrap: true 
                }}
              >
                {doc.originalFilename}
              </Typography>

              <Typography 
                variant="body2" 
                sx={{ 
                  color: 'text.secondary', 
                  fontSize: '13px', 
                  fontFamily: 'Inter, sans-serif',
                  noWrap: true 
                }}
              >
                {doc.uploadedBy || 'System'}
              </Typography>
              
              {/* Status dot indicator */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box 
                  sx={{ 
                    width: 6, 
                    height: 6, 
                    borderRadius: '50%', 
                    bgcolor: getStatusDotColor(doc.status) 
                  }} 
                />
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }}>
                  {doc.status}
                </Typography>
              </Box>
            </Box>
          ))}

          {documents.length === 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160 }}>
              <Typography variant="body2" sx={{ color: 'text.disabled', fontSize: '13px' }}>
                {t('no_docs_yet')}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Drawer Overlay */}
      <Box 
        className={drawerOpen ? 'drawer-overlay open' : 'drawer-overlay'}
        onClick={() => setDrawerOpen(false)}
        sx={{
          bgcolor: 'rgba(0, 0, 0, 0.4)'
        }}
      />

      {/* Drawer Panel */}
      <Box 
        className={drawerOpen ? 'drawer-slide-in open' : 'drawer-slide-in'}
        sx={{
          bgcolor: 'background.paper',
          borderLeft: '1px solid',
          borderColor: 'divider',
          color: 'text.primary',
          boxShadow: (theme) => theme.palette.mode === 'dark' ? 'none' : '-4px 0 24px rgba(0, 0, 0, 0.08)'
        }}
      >
        {selectedDoc && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', color: 'text.primary' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography 
                variant="h3" 
                sx={{ 
                  fontSize: '16px', 
                  fontWeight: 600, 
                  color: 'text.primary',
                  noWrap: true 
                }}
              >
                {t('details_header')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                  href={`/api/docs/${selectedDoc.id}/download`}
                  download
                  sx={{
                    height: 24,
                    fontSize: '11px',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    px: 1.5,
                    bgcolor: 'background.default',
                    '&:hover': {
                      borderColor: 'text.primary',
                      color: 'text.primary',
                      bgcolor: 'action.hover'
                    }
                  }}
                >
                  {t('download_action')}
                </Button>
                <Button 
                  onClick={() => setDrawerOpen(false)}
                  sx={{ 
                    color: 'text.secondary', 
                    fontSize: '12px',
                    p: 0,
                    minWidth: 'auto',
                    border: 'none',
                    background: 'transparent',
                    '&:hover': { color: 'text.primary', background: 'transparent' }
                  }}
                >
                  {t('close_action')}
                </Button>
              </Box>
            </Box>
            
            <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 500, fontSize: '13px', mb: 3, wordBreak: 'break-all' }}>
              {selectedDoc.originalFilename}
            </Typography>
            
            <Divider sx={{ borderColor: 'divider', mb: 3 }} />

            {loadingSummary ? (
              <Box sx={{ mt: 4 }}>
                <div className="skeleton-line" />
                <div className="skeleton-line mid" />
                <div className="skeleton-line short" />
              </Box>
            ) : docDetails ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Box>
                  <Typography variant="caption" sx={{ display: 'block', color: '#f97316', fontWeight: 500, fontSize: '10px', letterSpacing: '0.05em', mb: 1 }}>
                    {t('auto_summary')}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '13px', lineHeight: 1.5 }}>
                    {docDetails.summary}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" sx={{ display: 'block', color: '#f97316', fontWeight: 500, fontSize: '10px', letterSpacing: '0.05em', mb: 1.5 }}>
                    {t('key_entities')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {docDetails.entities.map((ent, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: '4px',
                          px: 1.5,
                          py: 0.5,
                          color: 'text.primary',
                          fontSize: '11px',
                          fontFamily: 'Inter, sans-serif'
                        }}
                      >
                        {ent}
                      </Box>
                    ))}
                  </Box>
                </Box>

                <Box>
                  <Typography variant="caption" sx={{ display: 'block', color: '#f97316', fontWeight: 500, fontSize: '10px', letterSpacing: '0.05em', mb: 1.5 }}>
                    {t('topic_clusters')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {docDetails.topics.map((t, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          border: '1px solid #f97316',
                          borderRadius: '4px',
                          px: 1.5,
                          py: 0.5,
                          color: '#f97316',
                          fontSize: '11px',
                          fontFamily: 'Inter, sans-serif'
                        }}
                      >
                        {t}
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            ) : null}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default DocumentPage;
