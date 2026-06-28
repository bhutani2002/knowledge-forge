import React, { useState, useRef } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useStore, api } from '../store';

const DocumentUpload = ({ onUploadSuccess }) => {
  const { t } = useTranslation();
  const { activeWorkspace, isAuthenticated } = useStore();
  
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const uploadFile = async (file) => {
    if (!isAuthenticated) {
      alert(t('login_required_upload'));
      window.dispatchEvent(new CustomEvent('open-auth-dialog'));
      return;
    }

    if (!activeWorkspace) {
      alert(t('select_workspace_required'));
      return;
    }

    setFileName(file.name);
    setUploading(true);
    setProgress(10);
    setStatusMessage(t('uploading'));

    const formData = new FormData();
    formData.append('file', file);
    formData.append('workspaceId', activeWorkspace.id);

    try {
      const res = await api.post('/api/docs/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(Math.min(10 + percentCompleted * 0.7, 80));
        }
      });

      setProgress(100);
      setStatusMessage(t('indexed'));
      setTimeout(() => {
        setUploading(false);
        setFileName('');
      }, 2000);

      if (onUploadSuccess) onUploadSuccess();

      const { stompClient } = useStore.getState();
      if (stompClient && stompClient.connected && activeWorkspace) {
        stompClient.publish({
          destination: `/topic/workspace/${activeWorkspace.id}/documents`,
          body: JSON.stringify({ action: 'UPLOADED', timestamp: Date.now() })
        });
      }

    } catch (e) {
      setProgress(0);
      setUploading(false);
      setFileName('');
      setStatusMessage('');
      alert(e.response?.data?.message || t('upload_failed'));
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      uploadFile(e.target.files[0]);
    }
  };

  return (
    <Box>
      <Box
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current.click()}
        sx={{
          py: 4,
          px: 2,
          textAlign: 'center',
          cursor: 'pointer',
          bgcolor: dragActive ? 'action.hover' : 'transparent',
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: '4px',
          transition: 'all 0.15s ease',
          '&:hover': {
            bgcolor: 'action.hover',
            borderColor: 'secondary.main'
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleChange}
          accept=".pdf,.docx,.txt,.json"
        />
        
        <Typography variant="body1" sx={{ fontWeight: 500, fontSize: '13px', color: 'text.primary', mb: 0.5 }}>
          {t('upload_zone')}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
          {t('upload_limits')}
        </Typography>
      </Box>

      {uploading && (
        <Box sx={{ width: '100%', mt: 2, px: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px', fontFamily: 'Inter, sans-serif' }}>
              {fileName}
            </Typography>
            <Typography variant="caption" sx={{ color: 'primary.main', fontSize: '11px', fontWeight: 500 }}>
              {statusMessage} ({Math.round(progress)}%)
            </Typography>
          </Box>
          <LinearProgress 
            variant="determinate" 
            value={progress} 
            sx={{ 
              height: 2, 
              bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' }
            }} 
          />
        </Box>
      )}
    </Box>
  );
};

export default DocumentUpload;
