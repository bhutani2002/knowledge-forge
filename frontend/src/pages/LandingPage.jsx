import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Typography, TextField, Button, Grid } from '@mui/material';
import {
  AutoAwesome as AgentIcon,
  Group as GroupIcon,
  FactCheck as FactIcon,
  ArrowForward as ArrowIcon
} from '@mui/icons-material';
import { useStore } from '../store';

const Logo = ({ size = 20 }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 100 100" 
    style={{ width: size, height: size, display: 'block' }}
  >
    <defs>
      <linearGradient id="landing-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#7c6af7', stopOpacity: 1 }} />
        <stop offset="100%" style={{ stopColor: '#e8845c', stopOpacity: 1 }} />
      </linearGradient>
    </defs>
    <polygon points="50,10 90,35 90,75 50,95 10,75 10,35" fill="url(#landing-logo-grad)" />
    <polygon points="50,22 78,40 78,70 50,84 22,70 22,40" fill="var(--color-bg-paper, #ffffff)" />
    <circle cx="50" cy="50" r="12" fill="url(#landing-logo-grad)" />
  </svg>
);

const LandingPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, createSession } = useStore();
  const [query, setQuery] = useState('');

  // Rotating placeholders list
  const placeholders = [
    t('ask_placeholder'),
    t('risk_placeholder'),
    t('compare_placeholder'),
    t('q3_placeholder')
  ];

  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleSearchSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    const session = await createSession(query.length > 25 ? query.substring(0, 25) + '...' : query);
    if (session) {
      navigate(`/chat?query=${encodeURIComponent(query)}`);
    } else {
      navigate('/chat');
    }
  };

  const sampleQueries = [
    t('sample_query_1'),
    t('sample_query_2'),
    t('sample_query_3')
  ];

  return (
    <Box
      sx={{
        minHeight: 'calc(100vh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        maxWidth: 960,
        mx: 'auto',
        textAlign: 'center',
        p: 3,
        pt: { xs: 2, md: 3 },
        pb: 2,
        position: 'relative'
      }}
    >
      {/* Premium background glow effect */}
      <Box
        sx={{
          position: 'absolute',
          top: '25%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '500px',
          height: '500px',
          background: 'radial-gradient(circle, rgba(249, 115, 22, 0.08) 0%, rgba(249, 115, 22, 0.0) 70%)',
          borderRadius: '50%',
          filter: 'blur(40px)',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* Hero Section */}
      <Box sx={{ zIndex: 1, flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', mt: { xs: 1, md: 2 } }}>
        {/* Brand Logo */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
          <Logo size={48} />
        </Box>
        
        {/* Uppercase Tagline */}
        <Typography
          variant="caption"
          sx={{
            color: 'primary.main',
            fontWeight: 600,
            fontSize: '11px',
            letterSpacing: '0.15em',
            mb: 1.5,
            textTransform: 'uppercase'
          }}
        >
          {t('ai_platform')}
        </Typography>

        {/* Heading */}
        <Typography
          variant="h1"
          sx={{
            fontFamily: 'Inter, sans-serif',
            fontSize: { xs: '32px', sm: '44px' },
            fontWeight: 700,
            mb: 1.5,
            color: 'text.primary',
            letterSpacing: '-0.03em',
            lineHeight: 1.15
          }}
        >
          {t('hero_title')}
        </Typography>

        {/* Subheading */}
        <Typography
          variant="body1"
          sx={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '14px',
            color: 'text.secondary',
            maxWidth: 620,
            mx: 'auto',
            mb: 3,
            lineHeight: 1.5,
            letterSpacing: '-0.01em'
          }}
        >
          {t('hero_desc')}
        </Typography>

        {/* Search Bar Input */}
        <Box component="form" onSubmit={handleSearchSubmit} sx={{ width: '100%', maxWidth: 720, mb: 2.5 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              height: 50,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '25px', // Pill-shaped
              px: 3,
              boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
              transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
              '&:focus-within': {
                borderColor: 'primary.main',
                boxShadow: '0 4px 24px rgba(249, 115, 22, 0.12), 0 0 0 1px rgba(249, 115, 22, 0.15)'
              }
            }}
          >
            <TextField
              fullWidth
              placeholder={placeholders[placeholderIndex]}
              variant="standard"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              InputProps={{
                disableUnderline: true,
                sx: {
                  color: 'text.primary',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '14px',
                  height: '100%',
                  '& input::placeholder': {
                    color: 'text.disabled',
                    opacity: 1
                  }
                }
              }}
            />
            <Button
              type="submit"
              sx={{
                backgroundColor: 'primary.main',
                color: 'primary.contrastText',
                border: 'none',
                borderRadius: '16px',
                fontWeight: 500,
                fontSize: '12px',
                height: 32,
                px: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                fontFamily: 'Inter, sans-serif',
                '&:hover': {
                  backgroundColor: '#ea580c'
                }
              }}
            >
              {t('ask_button')} <ArrowIcon sx={{ fontSize: '14px' }} />
            </Button>
          </Box>
        </Box>

        {/* Suggestion Chips */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.2, justifyContent: 'center', mb: 3.5 }}>
          {sampleQueries.map((q, idx) => (
            <Box
              key={idx}
              onClick={() => {
                setQuery(q);
              }}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '20px', // Round pill suggestion
                px: 2.5,
                py: 0.75,
                color: 'text.secondary',
                fontSize: '12px',
                fontFamily: 'Inter, sans-serif',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                bgcolor: 'background.paper',
                '&:hover': {
                  borderColor: 'primary.main',
                  color: 'text.primary',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                }
              }}
            >
              {q}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Bottom Features Cards Grid */}
      <Box sx={{ zIndex: 1, borderTop: '1px solid', borderColor: 'divider', pt: 3, pb: 1 }}>
        <Grid container spacing={3}>
          {/* Grounded Answers Card */}
          <Grid item xs={12} md={4}>
            <Box
              sx={{
                p: 2.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '8px',
                bgcolor: 'background.paper',
                textAlign: 'left',
                height: '100%',
                transition: 'transform 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)'
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(249, 115, 22, 0.08)', color: 'primary.main', borderRadius: '6px', width: 32, height: 32, mb: 1.5 }}>
                <FactIcon sx={{ fontSize: '18px' }} />
              </Box>
              <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.75, fontSize: '14px' }}>
                {t('grounded_answers_title')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5, fontSize: '12.5px' }}>
                {t('grounded_answers_desc')}
              </Typography>
            </Box>
          </Grid>

          {/* Team Workspaces Card */}
          <Grid item xs={12} md={4}>
            <Box
              sx={{
                p: 2.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '8px',
                bgcolor: 'background.paper',
                textAlign: 'left',
                height: '100%',
                transition: 'transform 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)'
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(249, 115, 22, 0.08)', color: 'primary.main', borderRadius: '6px', width: 32, height: 32, mb: 1.5 }}>
                <GroupIcon sx={{ fontSize: '18px' }} />
              </Box>
              <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.75, fontSize: '14px' }}>
                {t('team_workspaces_title')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5, fontSize: '12.5px' }}>
                {t('team_workspaces_desc')}
              </Typography>
            </Box>
          </Grid>

          {/* Multi-agent Reasoning Card */}
          <Grid item xs={12} md={4}>
            <Box
              sx={{
                p: 2.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '8px',
                bgcolor: 'background.paper',
                textAlign: 'left',
                height: '100%',
                transition: 'transform 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)'
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(249, 115, 22, 0.08)', color: 'primary.main', borderRadius: '6px', width: 32, height: 32, mb: 1.5 }}>
                <AgentIcon sx={{ fontSize: '18px' }} />
              </Box>
              <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.75, fontSize: '14px' }}>
                {t('multi_agent_reasoning_title')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5, fontSize: '12.5px' }}>
                {t('multi_agent_reasoning_desc')}
              </Typography>
            </Box>
          </Grid>
        </Grid>

        {/* Footer Powered By */}
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            color: 'text.disabled',
            fontFamily: 'Inter, sans-serif',
            fontSize: '11px',
            letterSpacing: '0.05em',
            mt: 3,
            textAlign: 'center'
          }}
        >
          {t('powered_by')}
        </Typography>
      </Box>
    </Box>
  );
};

export default LandingPage;
