import React, { useState } from 'react';
import { Box, Typography, Button, Collapse, TextField } from '@mui/material';
import ExplainabilityPanel from './ExplainabilityPanel';
import { useStore } from '../store';

const ChatMessage = ({ message, isStreaming }) => {
  const { id, role, senderName, content, citations, explainabilityReport, annotations } = message;
  const isUser = role === 'user';
  const [explainOpen, setExplainOpen] = useState(false);
  const [newAnnotation, setNewAnnotation] = useState('');
  const { isAuthenticated, annotateMessage } = useStore();

  const handleAddAnnotation = async () => {
    if (!newAnnotation.trim()) return;
    try {
      await annotateMessage(id, newAnnotation);
      setNewAnnotation('');
    } catch (e) {
      alert("Failed to add annotation: " + e.message);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        mb: 4,
        width: '100%'
      }}
    >
      {/* Sender Header */}
      <Typography
        variant="caption"
        sx={{
          mb: 0.75,
          px: isUser ? 1 : 2,
          fontWeight: 500,
          fontSize: '11px',
          color: 'text.secondary',
          letterSpacing: '0.02em'
        }}
      >
        {isUser ? senderName : senderName.toUpperCase()}
      </Typography>

      {/* Message Body Block */}
      <Box
        sx={{
          p: 1.5,
          pl: isUser ? 2 : 2,
          maxWidth: '720px',
          width: '100%',
          bgcolor: 'transparent',
          border: 'none',
          borderLeft: isUser ? '2px solid #f97316' : 'none',
          paddingLeft: isUser ? '16px' : '16px',
          color: 'text.primary',
          textAlign: 'left'
        }}
      >
        {/* Main message text */}
        <Typography
          variant="body1"
          sx={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'Inter, sans-serif',
            fontSize: '14px',
            color: 'text.primary',
            lineHeight: 1.6
          }}
        >
          {content}
          {isStreaming && <span className="streaming-cursor" />}
        </Typography>

        {/* Footnotes Section as horizontal pill boxes */}
        {!isUser && citations && citations.length > 0 && (
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                color: 'text.disabled',
                fontWeight: 500,
                fontSize: '10px',
                letterSpacing: '0.05em',
                mb: 1.5
              }}
            >
              FOOTNOTES
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
              {citations.map((c, i) => (
                <Box
                  key={i}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 1.5,
                    py: 0.5,
                    borderRadius: '16px',
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.default',
                    cursor: 'default'
                  }}
                  title={c.text}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main', fontSize: '11px' }}>
                    [{c.citation_id || (i + 1)}]
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.primary', fontSize: '11px', fontWeight: 500 }}>
                    {c.filename || 'Source'}
                  </Typography>
                  {c.page && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }}>
                      - pg. {c.page}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* Annotations Section */}
        {annotations && annotations.length > 0 && (
          <Box
            sx={{
              mt: 2,
              pl: 1.5,
              borderLeft: '1px dashed',
              borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontWeight: 500,
                color: '#f97316',
                fontSize: '10px',
                letterSpacing: '0.05em'
              }}
            >
              ANNOTATIONS
            </Typography>
            {annotations.map((ann, idx) => (
              <Typography
                key={idx}
                variant="caption"
                sx={{
                  display: 'block',
                  color: 'text.secondary',
                  fontSize: '11px',
                  fontStyle: 'italic'
                }}
              >
                • {ann}
              </Typography>
            ))}
          </Box>
        )}

        {/* Add Annotation Input bar */}
        {!isUser && !isStreaming && isAuthenticated && id !== 'stream-placeholder' && (
          <Box sx={{ mt: 2.5, display: 'flex', gap: 1, width: '100%', maxWidth: '360px', alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Add verification annotation..."
              value={newAnnotation}
              onChange={(e) => setNewAnnotation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddAnnotation();
              }}
              sx={{
                flexGrow: 1,
                '& .MuiInputBase-input': {
                  fontSize: '11px',
                  py: 0.5,
                  fontFamily: 'Inter, sans-serif'
                }
              }}
            />
            <Button
              size="small"
              onClick={handleAddAnnotation}
              sx={{
                fontSize: '11px',
                height: 28,
                borderColor: 'divider',
                color: 'text.primary'
              }}
            >
              Annotate
            </Button>
          </Box>
        )}
      </Box>

      {/* Outlined Button for Reasoning */}
      {!isUser && explainabilityReport && (
        <Box sx={{ width: '100%', mt: 2, pl: 2, display: 'flex', justifyContent: 'flex-start' }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setExplainOpen(!explainOpen)}
            sx={{
              textTransform: 'none',
              borderColor: 'divider',
              color: 'text.secondary',
              fontSize: '12px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 500,
              height: 28,
              px: 2,
              '&:hover': {
                borderColor: 'text.secondary',
                bgcolor: 'action.hover',
                color: 'text.primary'
              }
            }}
          >
            {explainOpen ? "Hide reasoning" : "Show reasoning"}
          </Button>
        </Box>
      )}

      {!isUser && explainabilityReport && (
        <Box sx={{ width: '100%', pl: 2 }}>
          <Collapse in={explainOpen}>
            <Box sx={{ mt: 2, maxWidth: '720px' }}>
              <ExplainabilityPanel report={explainabilityReport} />
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
};

export default ChatMessage;
