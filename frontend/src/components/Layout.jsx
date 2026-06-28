import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore, api } from '../store';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';
import {
  AppBar, Toolbar, Typography, Button, IconButton, Select, MenuItem,
  Box, Drawer, List, ListItem, ListItemIcon, ListItemText, Divider,
  Avatar, Dialog, DialogTitle, DialogContent, TextField, DialogActions
} from '@mui/material';
import {
  Menu as MenuIcon,
  ChevronLeft as ChevronLeftIcon,
  SmartToyOutlined as ChatIcon,
  FolderCopyOutlined as DocIcon,
  AnalyticsOutlined as DashIcon,
  DarkMode as DarkIcon,
  LightMode as LightIcon,
  Translate as LangIcon,
  GroupOutlined as ShareIcon
} from '@mui/icons-material';

const Logo = ({ size = 20, isDark }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 100 100" 
    style={{ width: size, height: size, display: 'block' }}
  >
    <defs>
      <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#7c6af7', stopOpacity: 1 }} />
        <stop offset="100%" style={{ stopColor: '#e8845c', stopOpacity: 1 }} />
      </linearGradient>
    </defs>
    <polygon points="50,10 90,35 90,75 50,95 10,75 10,35" fill="url(#logo-grad)" />
    <polygon points="50,22 78,40 78,70 50,84 22,70 22,40" fill={isDark ? '#111625' : '#ffffff'} />
    <circle cx="50" cy="50" r="12" fill="url(#logo-grad)" />
  </svg>
);

const Layout = ({ children }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  
  const {
    user, isAuthenticated, activeWorkspace, workspaces, setActiveWorkspace,
    createWorkspace, login, register, logout, themeMode, setThemeMode
  } = useStore();

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const getTranslatedWorkspaceName = (name) => {
    if (name === "Default Workspace") return t("default_workspace");
    if (name === "Public Demo Workspace") return t("public_workspace");
    return name;
  };

  const [authOpen, setAuthOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // STOMP WebSocket Channel Connection
  useEffect(() => {
    if (!activeWorkspace) return;
    // Only connect to custom workspace presence if authenticated
    if (activeWorkspace.id !== '00000000-0000-0000-0000-000000000000' && !isAuthenticated) return;

    const socket = new SockJS('/ws');
    const client = new Client({
      webSocketFactory: () => socket,
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
    });

    const currentUserId = user?.userId || localStorage.getItem('guestUserId') || 'guest';
    let joinTimeout = null;

    client.onConnect = (frame) => {
      useStore.getState().setStompClient(client);

      // Subscribe to sessions list updates
      client.subscribe(`/topic/workspace/${activeWorkspace.id}/sessions`, (msg) => {
        const data = JSON.parse(msg.body);
        if (data.userId && data.userId === currentUserId) return; // ignore our own events

        if (data.action === 'CREATE') {
          useStore.getState().addSessionFromWs(data.session);
        } else if (data.action === 'RENAME') {
          useStore.getState().renameSessionFromWs(data.sessionId, data.title);
        } else if (data.action === 'DELETE') {
          useStore.getState().deleteSessionFromWs(data.sessionId);
        }
      });

      // Subscribe to documents updates
      client.subscribe(`/topic/workspace/${activeWorkspace.id}/documents`, (msg) => {
        const data = JSON.parse(msg.body);
        if (data.action === 'UPLOADED') {
          useStore.getState().fetchDocuments();
        }
      });

      // Subscribe to chat message updates
      client.subscribe(`/topic/workspace/${activeWorkspace.id}/messages`, (msg) => {
        const data = JSON.parse(msg.body);
        if (data.userId && data.userId === currentUserId) return; // ignore our own events

        if (data.action === 'ADD_MESSAGE') {
          const currentSession = useStore.getState().currentSession;
          if (currentSession && currentSession.id === data.message.sessionId) {
            useStore.getState().addMessageFromWs(data.message);
          }
        }
      });

      // Subscribe to typing updates
      client.subscribe(`/topic/workspace/${activeWorkspace.id}/typing`, (msg) => {
        const data = JSON.parse(msg.body);
        const name = data.username;
        const typing = data.typing;
        const incomingSessionId = data.sessionId || 'new';

        if (name && name !== (user?.displayName || user?.email || 'Guest')) {
          useStore.getState().setTypingUsers((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const filtered = list.filter(u => u.username !== name);
            if (typing) {
              return [...filtered, { username: name, sessionId: incomingSessionId }];
            }
            return filtered;
          });
        }
      });

      // Subscribe to presence updates
      client.subscribe(`/topic/workspace/${activeWorkspace.id}/presence`, (msg) => {
        const data = JSON.parse(msg.body);
        if (data.userId === currentUserId) return; // ignore our own events

        if (data.action === 'JOIN') {
          useStore.getState().setPresenceList((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const exists = list.find((p) => p.userId === data.userId);
            if (!exists) {
              return [...list, data];
            }
            // Update fields if changed
            return list.map(p => p.userId === data.userId ? data : p);
          });

          // Respond with our presence so the new user knows we are online
          if (!data.isReply) {
            client.publish({
              destination: `/app/workspace/${activeWorkspace.id}/presence`,
              body: JSON.stringify({
                userId: currentUserId,
                username: user?.displayName || user?.email || 'Guest User',
                displayName: user?.displayName || '',
                email: user?.email || '',
                action: 'JOIN',
                isReply: true
              })
            });
          }
        } else if (data.action === 'LEAVE') {
          useStore.getState().setPresenceList((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            return list.filter((p) => p.userId !== data.userId);
          });
        }
      });

      // Delay initial JOIN publish to guarantee our SUBSCRIBE registration on broker is complete first
      joinTimeout = setTimeout(() => {
        if (client.connected) {
          client.publish({
            destination: `/app/workspace/${activeWorkspace.id}/presence`,
            body: JSON.stringify({
              userId: currentUserId,
              username: user?.displayName || user?.email || 'Guest User',
              displayName: user?.displayName || '',
              email: user?.email || '',
              action: 'JOIN',
              isReply: false
            })
          });
        }
      }, 300);
    };

    client.activate();

    return () => {
      if (joinTimeout) clearTimeout(joinTimeout);
      if (client && client.connected) {
        try {
          client.publish({
            destination: `/app/workspace/${activeWorkspace.id}/presence`,
            body: JSON.stringify({
              userId: currentUserId,
              username: user?.displayName || user?.email || 'Guest User',
              action: 'LEAVE'
            })
          });
        } catch (e) {}
        setTimeout(() => {
          try {
            client.deactivate();
          } catch (e) {}
        }, 100);
      } else {
        try {
          client.deactivate();
        } catch (e) {}
      }
      useStore.getState().setStompClient(null);
      useStore.getState().setPresenceList([]);
      useStore.getState().setTypingUsers([]);
    };
  }, [activeWorkspace, user, isAuthenticated]);

  // Telemetry state
  const [liveLatency, setLiveLatency] = useState(null);
  const [apiOnline, setApiOnline] = useState(true);

  useEffect(() => {
    const measureLatency = async () => {
      const start = performance.now();
      try {
        await api.get('/api/auth/health');
        const end = performance.now();
        setLiveLatency(Math.round(end - start));
        setApiOnline(true);
      } catch (err) {
        const end = performance.now();
        const rtt = Math.round(end - start);
        // Fallback RTT check (if CORS blocks actuator, connection still completed)
        if (rtt < 1000) {
          setLiveLatency(rtt);
          setApiOnline(true);
        } else {
          setLiveLatency(null);
          setApiOnline(false);
        }
      }
    };

    measureLatency();
    const interval = setInterval(measureLatency, 60000); // Check latency/status every 60 seconds (1 minute)
    return () => clearInterval(interval);
  }, []);

  // Workspace Share states
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const fetchMembers = async () => {
    if (!activeWorkspace || activeWorkspace.id === '00000000-0000-0000-0000-000000000000') return;
    try {
      const res = await api.get(`/api/workspaces/${activeWorkspace.id}/members`);
      setWorkspaceMembers(res.data);
    } catch (e) {
      console.error("Failed to fetch members", e);
    }
  };

  useEffect(() => {
    if (shareOpen) {
      fetchMembers();
      setInviteError('');
      setInviteSuccess('');
      setInviteEmail('');
    }
  }, [shareOpen, activeWorkspace]);
  const [displayName, setDisplayName] = useState('');
  const [newWsOpen, setNewWsOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [authError, setAuthError] = useState('');

  // Handle open-auth-dialog event from LandingPage
  useEffect(() => {
    const handleOpenAuth = () => setAuthOpen(true);
    window.addEventListener('open-auth-dialog', handleOpenAuth);
    return () => window.removeEventListener('open-auth-dialog', handleOpenAuth);
  }, []);

  const handleLangToggle = () => {
    const currentLang = i18n.language || 'en';
    const nextLang = currentLang.startsWith('en') ? 'hi' : 'en';
    i18n.changeLanguage(nextLang);
  };

  const handleAuthSubmit = async () => {
    setAuthError('');
    try {
      if (isRegister) {
        await register(email, password, displayName);
        setIsRegister(false);
        setAuthError('Registration successful! Please login.');
      } else {
        await login(email, password);
        setAuthOpen(false);
      }
    } catch (e) {
      setAuthError(e.message);
    }
  };

  const handleCreateWs = async () => {
    if (!newWsName.trim()) return;
    try {
      await createWorkspace(newWsName);
      setNewWsOpen(false);
      setNewWsName('');
    } catch (e) {
      alert("Failed to create workspace: " + e.message);
    }
  };

  const menuItems = [
    { text: t('chat'), icon: <ChatIcon sx={{ fontSize: '18px' }} />, path: '/chat' },
    { text: t('documents'), icon: <DocIcon sx={{ fontSize: '18px' }} />, path: '/documents' },
    { text: t('dashboard'), icon: <DashIcon sx={{ fontSize: '18px' }} />, path: '/dashboard' }
  ];

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default', overflow: 'hidden' }}>
      <AppBar 
        position="fixed" 
        sx={{ 
          zIndex: (theme) => theme.zIndex.drawer + 1, 
          bgcolor: 'background.paper', 
          borderBottom: '1px solid',
          borderColor: 'divider',
          boxShadow: 'none',
          backgroundImage: 'none'
        }}
      >
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', height: 56, px: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {!sidebarOpen && (
              <IconButton 
                onClick={() => setSidebarOpen(true)}
                sx={{ color: 'text.secondary', mr: 0.5 }}
                title="Expand sidebar"
                size="small"
              >
                <MenuIcon sx={{ fontSize: '20px' }} />
              </IconButton>
            )}
            <Box 
              onClick={() => navigate('/')}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
            >
              <Logo size={20} isDark={themeMode === 'dark'} />
              <Typography 
                variant="h6" 
                component="div" 
                sx={{ 
                  fontWeight: 600, 
                  fontSize: '16px',
                  color: 'text.primary', 
                  letterSpacing: '-0.01em'
                }} 
              >
                {t('site_name') === 'KnowledgeForge' ? (
                  <>Knowledge<span style={{ color: '#f97316' }}>Forge</span></>
                ) : (
                  t('site_name')
                )}
              </Typography>
            </Box>
            
            {isAuthenticated && workspaces.length === 0 && (
              <Button 
                onClick={() => setNewWsOpen(true)} 
                size="small" 
                sx={{ 
                  ml: 2, 
                  height: 28, 
                  fontSize: '12px', 
                  borderColor: 'divider',
                  color: 'text.primary'
                }}
              >
                + {t('create_workspace')}
              </Button>
            )}

            {isAuthenticated && workspaces.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Select
                  value={activeWorkspace ? activeWorkspace.id : ''}
                  onChange={(e) => {
                    if (e.target.value === '') {
                      setNewWsOpen(true);
                    } else {
                      const ws = workspaces.find(w => w.id === e.target.value);
                      if (ws) setActiveWorkspace(ws);
                    }
                  }}
                  size="small"
                  renderValue={(value) => {
                    const ws = workspaces.find(w => w.id === value);
                    if (ws) return getTranslatedWorkspaceName(ws.name);
                    if (value === '00000000-0000-0000-0000-000000000000') return t('public_workspace');
                    return t('default_workspace');
                  }}
                  sx={{ 
                    ml: 2, 
                    minWidth: 160, 
                    height: 32,
                    fontSize: '12px',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    fontWeight: 600,
                    borderRadius: '6px',
                    '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: 'none' },
                    '&:hover': { bgcolor: (theme) => theme.palette.mode === 'dark' ? '#ea580c' : '#c2410c' },
                    '.MuiSelect-select': { 
                      py: 0, 
                      color: 'primary.contrastText',
                      display: 'flex',
                      alignItems: 'center'
                    },
                    '.MuiSvgIcon-root': { color: 'primary.contrastText' }
                  }}
                >
                  {workspaces.map((ws) => (
                    <MenuItem key={ws.id} value={ws.id} sx={{ fontSize: '12px' }}>
                      {getTranslatedWorkspaceName(ws.name)}
                    </MenuItem>
                  ))}
                  <Divider />
                  <MenuItem value="" sx={{ fontSize: '12px', color: 'primary.main' }}>+ {t('create_workspace')}</MenuItem>
                </Select>
                {activeWorkspace && activeWorkspace.id !== '00000000-0000-0000-0000-000000000000' && (
                  <IconButton 
                    onClick={() => setShareOpen(true)} 
                    size="small" 
                    title="Workspace Members & Invite"
                    sx={{ 
                      height: 32, 
                      width: 32, 
                      color: 'text.secondary',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: '4px',
                      bgcolor: 'background.default',
                      '&:hover': {
                        bgcolor: 'action.hover',
                        borderColor: 'text.primary'
                      }
                    }}
                  >
                    <ShareIcon sx={{ fontSize: '16px' }} />
                  </IconButton>
                )}
              </Box>
            )}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton onClick={handleLangToggle} sx={{ color: 'text.secondary' }}>
              <LangIcon sx={{ fontSize: '18px' }} />
            </IconButton>
            
            <IconButton 
              onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')} 
              sx={{ color: 'text.secondary' }}
            >
              {themeMode === 'dark' ? <LightIcon sx={{ fontSize: '18px' }} /> : <DarkIcon sx={{ fontSize: '18px' }} />}
            </IconButton>
            
            {isAuthenticated ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 2 }}>
                <Avatar 
                  sx={{ 
                    bgcolor: 'action.hover', 
                    color: 'text.primary',
                    width: 28, 
                    height: 28,
                    fontSize: '12px',
                    border: '1px solid',
                    borderColor: 'divider'
                  }} 
                  title={user?.displayName || user?.email}
                >
                  {(user?.displayName || user?.email)?.[0].toUpperCase()}
                </Avatar>
                <Button 
                  onClick={logout} 
                  size="small"
                  sx={{
                    height: 28,
                    fontSize: '11px',
                    borderColor: 'divider',
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary' }
                  }}
                >
                  {t('logout')}
                </Button>
              </Box>
            ) : (
              <Button 
                onClick={() => setAuthOpen(true)} 
                sx={{ 
                  ml: 2,
                  height: 32,
                  fontSize: '12px',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  border: 'none',
                  '&:hover': { bgcolor: '#ea580c' }
                }}
              >
                {t('login')}
              </Button>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          width: sidebarOpen ? 240 : 0,
          flexShrink: 0,
          transition: (theme) => theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
          [`& .MuiDrawer-paper`]: { 
            width: sidebarOpen ? 240 : 0, 
            boxSizing: 'border-box', 
            bgcolor: 'background.paper', 
            borderRight: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            transition: (theme) => theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
            overflowX: 'hidden'
          },
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflowX: 'hidden', overflowY: 'auto' }}>
          <Toolbar sx={{ height: 56 }} />
          
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 3, pb: 1 }}>
            <Typography 
              variant="caption" 
              sx={{ 
                display: 'block', 
                fontWeight: 500, 
                fontSize: '11px',
                color: 'text.disabled', 
                letterSpacing: '0.05em' 
              }}
            >
              {t('gateway').toUpperCase()}
            </Typography>
            <IconButton 
              onClick={() => setSidebarOpen(false)}
              size="small"
              title="Collapse sidebar"
              sx={{ 
                color: 'text.secondary',
                p: 0.5,
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
              <ChevronLeftIcon sx={{ fontSize: '18px' }} />
            </IconButton>
          </Box>

          <List sx={{ px: 1 }}>
            {menuItems.map((item) => {
              const isSelected = location.pathname === item.path;
              return (
                <ListItem
                  button
                  key={item.text}
                  onClick={() => navigate(item.path)}
                  sx={{
                    mx: 0.5,
                    my: 0.25,
                    borderRadius: '4px',
                    transition: 'all 0.15s',
                    borderLeft: isSelected ? '3px solid #f97316' : '3px solid transparent',
                    bgcolor: 'transparent',
                    '&:hover': {
                      bgcolor: 'action.hover'
                    }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32, color: isSelected ? 'text.primary' : 'text.disabled' }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText 
                    primary={item.text} 
                    primaryTypographyProps={{ 
                      fontWeight: isSelected ? 500 : 400, 
                      fontSize: '13px',
                      color: isSelected ? 'text.primary' : 'text.secondary'
                    }} 
                  />
                </ListItem>
              );
            })}
          </List>

          <Divider sx={{ mx: 2, my: 2, borderColor: 'divider' }} />

          {isAuthenticated && (
            <Box sx={{ px: 3 }}>
              <Typography 
                variant="caption" 
                sx={{ 
                  display: 'block', 
                  fontWeight: 500, 
                  fontSize: '11px',
                  color: 'text.disabled', 
                  letterSpacing: '0.05em', 
                  mb: 1.5 
                }}
              >
                {t('workspace').toUpperCase()}
              </Typography>
              <Box 
                sx={{ 
                  p: 1.5, 
                  borderRadius: '4px', 
                  border: '1px solid',
                  borderColor: 'divider', 
                  bgcolor: 'background.default',
                  mb: 2 
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', noWrap: true }}>
                  {getTranslatedWorkspaceName(activeWorkspace?.name) || t('default_workspace')}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '10px' }}>
                  {t('developer_tier')}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>

        {/* Telemetry Sidebar Footer */}
        <Box 
          sx={{ 
            p: 2, 
            borderTop: '1px solid',
            borderColor: 'divider', 
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            gap: 1
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: apiOnline ? '#22c55e' : '#ef4444' }} />
              <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500, fontSize: '11px' }}>
                {apiOnline ? t('pipeline_active') : 'System Offline'}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.primary', fontSize: '10px', px: 1, py: 0.2, borderRadius: '4px', border: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}>
              {apiOnline ? t('sla_label') : 'SLA Degraded'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '10px' }}>
              {t('build_version')}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '10px' }}>
              {apiOnline && liveLatency !== null ? `${liveLatency}ms latency` : 'offline'}
            </Typography>
          </Box>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Toolbar />
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {children}
        </Box>
      </Box>

      {/* Auth Dialog */}
      <Dialog 
        open={authOpen} 
        onClose={() => setAuthOpen(false)} 
        maxWidth="xs" 
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '12px',
            backgroundImage: 'none',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2)',
            p: 1.5
          }
        }}
      >
        <DialogTitle sx={{ pb: 3, pt: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Avatar 
              sx={{ 
                bgcolor: 'rgba(249, 115, 22, 0.1)', 
                color: 'primary.main', 
                width: 46, 
                height: 46, 
                mb: 1.5,
                fontSize: '22px',
                border: '1px solid rgba(249, 115, 22, 0.2)'
              }}
            >
              {isRegister ? '📝' : '🔑'}
            </Avatar>
            <Typography variant="h3" sx={{ fontWeight: 700, fontSize: '18px', color: 'text.primary', fontFamily: 'Inter, sans-serif' }}>
              {isRegister ? t('create_account', 'Create Account') : t('welcome_back', 'Welcome Back')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '11px', mt: 0.5 }}>
              {isRegister ? t('register_sub', 'Join our collaborative knowledge workspace') : t('login_sub', 'Sign in to access your custom AI search')}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3.5, display: 'flex', flexDirection: 'column', gap: 2.5, overflow: 'visible' }}>
          {authError && (
            <Typography sx={{ fontSize: '12px', color: 'error.main', textAlign: 'center' }}>
              {authError}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1.5 }}>
            {isRegister && (
              <TextField
                margin="none"
                label="Display Name"
                type="text"
                fullWidth
                variant="outlined"
                size="small"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                InputLabelProps={{ sx: { fontSize: '12px', color: 'text.secondary' } }}
                inputProps={{ sx: { fontSize: '13px', color: 'text.primary' } }}
              />
            )}
            <TextField
              margin="none"
              label="Email Address"
              type="email"
              fullWidth
              variant="outlined"
              size="small"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              InputLabelProps={{ sx: { fontSize: '12px', color: 'text.secondary' } }}
              inputProps={{ sx: { fontSize: '13px', color: 'text.primary' } }}
            />
            <TextField
              margin="none"
              label="Password"
              type="password"
              fullWidth
              variant="outlined"
              size="small"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              InputLabelProps={{ sx: { fontSize: '12px', color: 'text.secondary' } }}
              inputProps={{ sx: { fontSize: '13px', color: 'text.primary' } }}
            />
          </Box>
          
          <Button
            onClick={() => setIsRegister(!isRegister)}
            sx={{ 
              alignSelf: 'flex-start',
              fontSize: '11px', 
              p: 0, 
              color: 'text.secondary', 
              textDecoration: 'underline',
              background: 'transparent',
              border: 'none',
              minWidth: 'auto',
              justifyContent: 'flex-start',
              '&:hover': { color: 'text.primary', background: 'transparent', textDecoration: 'underline' }
            }}
          >
            {isRegister ? t('have_account') : t('no_account')}
          </Button>
 
          <Divider sx={{ my: 1, borderColor: 'divider', '&::before, &::after': { borderColor: 'divider' } }}>
            <span style={{ fontSize: '10px', color: 'text.disabled' }}>OR</span>
          </Divider>
 
          {/* OAuth Redirect button */}
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Button
              component="a"
              href="http://localhost:8080/oauth2/authorization/google"
              startIcon={
                <svg width="16" height="16" viewBox="0 0 18 18" style={{ marginRight: '6px' }}>
                  <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.8 2.71v2.24h2.91c1.7-1.56 2.69-3.87 2.69-6.58z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.24c-.8.54-1.84.87-3.05.87-2.35 0-4.33-1.59-5.04-3.73H.96v2.3C2.44 15.86 5.49 18 9 18z"/>
                  <path fill="#FBBC05" d="M3.96 10.72A5.4 5.4 0 0 1 3.6 9c0-.6.1-1.17.28-1.72V4.98H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.02l3-2.3z"/>
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35L15 2.08C13.46.64 11.43 0 9 0 5.49 0 2.44 2.14.96 4.98l3 2.3C4.67 5.17 6.65 3.58 9 3.58z"/>
                </svg>
              }
              sx={{
                width: '100%',
                height: 38,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                color: 'text.primary',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'all 0.2s ease',
                '&:hover': { 
                  bgcolor: 'action.hover', 
                  borderColor: 'text.secondary',
                  transform: 'translateY(-1px)',
                  boxShadow: '0 3px 6px rgba(0,0,0,0.08)'
                }
              }}
            >
              {t('signin_google')}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2.5, pt: 1, borderTop: '1px solid', borderColor: 'divider', mt: 2 }}>
          <Button 
            onClick={() => setAuthOpen(false)}
            sx={{ height: 32, fontSize: '12px', color: 'text.secondary', border: 'none', '&:hover': { bgcolor: 'action.hover' } }}
          >
            {t('cancel')}
          </Button>
          <Button 
            onClick={handleAuthSubmit} 
            variant="contained"
            sx={{ height: 32, fontSize: '12px', bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: '#ea580c' } }}
          >
            {isRegister ? t('register') : t('login')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Workspace Dialog */}
      <Dialog 
        open={newWsOpen} 
        onClose={() => setNewWsOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '8px',
            backgroundImage: 'none'
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 500, fontSize: '16px', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', pb: 2 }}>
          {t('create_workspace')}
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <TextField
            autoFocus
            margin="dense"
            label={t('workspace_name')}
            fullWidth
            variant="outlined"
            size="small"
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            InputLabelProps={{ sx: { fontSize: '12px', color: 'text.secondary' } }}
            inputProps={{ sx: { fontSize: '13px', color: 'text.primary' } }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid', borderColor: 'divider', mt: 2 }}>
          <Button 
            onClick={() => setNewWsOpen(false)}
            sx={{ height: 32, fontSize: '12px', color: 'text.secondary', border: 'none', '&:hover': { bgcolor: 'action.hover' } }}
          >
            {t('cancel')}
          </Button>
          <Button 
            onClick={handleCreateWs} 
            variant="contained"
            sx={{ height: 32, fontSize: '12px', bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: '#ea580c' } }}
          >
            {t('create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Share / Manage Access Dialog */}
      <Dialog 
        open={shareOpen} 
        onClose={() => setShareOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '8px',
            backgroundImage: 'none'
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 500, fontSize: '16px', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', pb: 2 }}>
          {t('share_workspace', 'Workspace Access')}
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          {/* Invite form */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px', display: 'block' }}>
              {t('invite_helper', 'Invite a collaborator by entering their registered email address.')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                placeholder="collaborator@email.com"
                size="small"
                fullWidth
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                error={!!inviteError}
                helperText={inviteError}
                inputProps={{ sx: { fontSize: '13px', color: 'text.primary' } }}
              />
              <Button 
                variant="contained" 
                size="small"
                onClick={async () => {
                  setInviteError('');
                  setInviteSuccess('');
                  if (!inviteEmail.trim()) return;
                  try {
                    await api.post(`/api/workspaces/${activeWorkspace.id}/members/invite`, { email: inviteEmail });
                    setInviteSuccess(t('invite_success', 'Invited successfully!'));
                    setInviteEmail('');
                    fetchMembers();
                  } catch (e) {
                    setInviteError(e.response?.data?.message || t('invite_failed', 'Invite failed'));
                  }
                }}
                sx={{ height: 40, px: 2, textTransform: 'none', fontSize: '12px', bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: '#ea580c' } }}
              >
                {t('invite_action', 'Invite')}
              </Button>
            </Box>
            {inviteSuccess && (
              <Typography variant="caption" sx={{ color: 'success.main', display: 'block', mt: -0.5 }}>
                {inviteSuccess}
              </Typography>
            )}
          </Box>

          <Divider sx={{ my: 2.5, borderColor: 'divider' }} />

          {/* Members list */}
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.disabled', letterSpacing: '0.05em', display: 'block', mb: 1.5 }}>
            {t('members_list_header', 'CURRENT COLLABORATORS')}
          </Typography>
          <List sx={{ py: 0, display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto' }}>
            {workspaceMembers.map((member) => {
              const isOwner = activeWorkspace?.ownerId === member.userId;
              const isCurrentUser = member.userId === user?.userId;
              return (
                <ListItem 
                  key={member.id}
                  disableGutters
                  secondaryAction={
                    (!isOwner && (activeWorkspace?.ownerId === user?.userId || isCurrentUser)) ? (
                      <Button 
                        size="small" 
                        color="error" 
                        onClick={async () => {
                          const confirmMsg = isCurrentUser 
                            ? t('confirm_leave', 'Are you sure you want to leave this workspace?') 
                            : t('confirm_remove', 'Remove this collaborator?');
                          if (window.confirm(confirmMsg)) {
                            try {
                              await api.delete(`/api/workspaces/${activeWorkspace.id}/members/${member.userId}`);
                              if (isCurrentUser) {
                                setShareOpen(false);
                                useStore.getState().fetchWorkspaces();
                              } else {
                                fetchMembers();
                              }
                            } catch (e) {
                              alert("Failed to remove member: " + (e.response?.data?.message || e.message));
                            }
                          }
                        }}
                        sx={{ fontSize: '11px', textTransform: 'none', minWidth: 'auto', p: '2px 8px' }}
                      >
                        {isCurrentUser ? t('leave_action', 'Leave') : t('remove_action', 'Remove')}
                      </Button>
                    ) : null
                  }
                >
                  <Avatar sx={{ width: 28, height: 28, fontSize: '12px', mr: 1.5, bgcolor: isOwner ? 'secondary.main' : 'primary.main', color: 'primary.contrastText', fontWeight: 600 }}>
                    {member.email[0].toUpperCase()}
                  </Avatar>
                  <ListItemText 
                    primary={member.displayName || member.email.split('@')[0]}
                    primaryTypographyProps={{ fontSize: '13px', fontWeight: 500, color: 'text.primary', noWrap: true }}
                    secondary={member.email}
                    secondaryTypographyProps={{ fontSize: '11px', color: 'text.secondary', noWrap: true }}
                  />
                </ListItem>
              );
            })}
          </List>
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid', borderColor: 'divider', mt: 2 }}>
          <Button onClick={() => setShareOpen(false)} sx={{ height: 32, fontSize: '12px', color: 'text.secondary', border: 'none', '&:hover': { bgcolor: 'action.hover' } }}>
            {t('close_action', 'Close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Layout;
