import { createTheme } from '@mui/material/styles';

export const getMuiTheme = (mode) => {
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode: isDark ? 'dark' : 'light',
      primary: {
        main: isDark ? '#f97316' : '#ea580c', // Orange accent
        contrastText: isDark ? '#090b11' : '#ffffff',
      },
      secondary: {
        main: isDark ? '#94a3b8' : '#475569',
      },
      background: {
        default: isDark ? '#090b11' : '#edf2f7', // midnight navy / cool clean slate-gray
        paper: isDark ? '#111625' : '#ffffff', // slate navy / pure white
      },
      text: {
        primary: isDark ? '#f8fafc' : '#0f172a', // off-white / slate 900
        secondary: isDark ? '#94a3b8' : '#475569', // cool gray / slate 600
        disabled: isDark ? '#64748b' : '#94a3b8',
      },
      divider: isDark ? '#1f293d' : '#cbd5e1', // slate border / clean border
      action: {
        selected: isDark ? 'rgba(249, 115, 22, 0.12)' : 'rgba(234, 88, 12, 0.08)',
        hover: isDark ? '#1e293b' : '#e2e8f0',
      }
    },
    typography: {
      fontFamily: 'Inter, sans-serif',
      h1: { fontSize: '32px', fontWeight: 600, letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' },
      h2: { fontSize: '24px', fontWeight: 600, letterSpacing: '-0.02em', fontFamily: 'Inter, sans-serif' },
      h3: { fontSize: '20px', fontWeight: 500, letterSpacing: '-0.01em', fontFamily: 'Inter, sans-serif' },
      body1: { fontSize: '14px', lineHeight: 1.5, letterSpacing: '0' },
      body2: { fontSize: '12px', lineHeight: 1.5, letterSpacing: '0' },
      button: { fontSize: '14px', fontWeight: 500, textTransform: 'none' },
    },
    shape: {
      borderRadius: 6,
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            textTransform: 'none',
            fontWeight: 500,
            borderRadius: 6,
            border: `1px solid ${theme.palette.divider}`,
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            boxShadow: 'none',
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
              borderColor: theme.palette.secondary.main,
              boxShadow: 'none',
            },
            '&.MuiButton-containedPrimary': {
              backgroundColor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              border: 'none',
              '&:hover': {
                backgroundColor: isDark ? '#ea580c' : '#c2410c',
              },
            },
          }),
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundImage: 'none',
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
            borderRadius: 6,
          }),
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundImage: 'none',
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
            borderRadius: 6,
          }),
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 4,
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.divider,
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.secondary.main,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.primary.main,
              borderWidth: '1px',
            },
          }),
        },
      },
    },
  });
};
