import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore, api } from '../store';
import {
  Box, Grid, Typography, TextField, Button, List, ListItem, ListItemButton, Avatar, Badge, Divider, ListItemText,
  Menu, MenuItem, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Select, Tooltip
} from '@mui/material';
import {
  MoreVert as MoreIcon,
  CloudQueue as CloudIcon,
  EditOutlined as EditIcon,
  DeleteOutline as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  ChevronLeft as ChevronLeftIcon
} from '@mui/icons-material';
import ChatMessage from '../components/ChatMessage';

const ChatPage = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('query');

  const getTranslatedWorkspaceName = (name) => {
    if (name === "Default Workspace") return t("default_workspace");
    if (name === "Public Demo Workspace") return t("public_workspace");
    return name;
  };

  const {
    user, activeWorkspace, workspaces, sessions, currentSession, messages,
    createSession, setCurrentSession, addMessage, updateLastMessageContent,
    setStreaming, isStreaming, fetchSessions, fetchDocuments, documents, isAuthenticated,
    renameSession, deleteSession, stompClient, presenceList = [], typingUsers = []
  } = useStore();

  const [input, setInput] = useState('');
  const [docsOpen, setDocsOpen] = useState(false);

  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuSession, setMenuSession] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [agentStatusOpen, setAgentStatusOpen] = useState(true);
  const [chatMenuOpen, setChatMenuOpen] = useState(true);

  const guestUserId = localStorage.getItem('guestUserId');
  const currentUserId = user?.userId || guestUserId || 'guest';
  const uniqueCollaborators = (presenceList || [])
    .filter(p => p && p.userId !== currentUserId)
    .filter((value, index, self) => self.findIndex(t => t.userId === value.userId) === index);

  const [streamStage, setStreamStage] = useState(0); // 0: Idle, 1: InputGuardrail, 2: QueryRewriter, 3: MultiQuery, 4: ReRanker, 5: Answer, 6: OutputGuardrail
  const stageTimersRef = useRef([]);

  const clearStageTimers = () => {
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];
  };

  useEffect(() => {
    return () => clearStageTimers();
  }, []);

  const getAgentStatusAndColor = (agentIndex, stage) => {
    if (stage === 0) {
      return { status: 'Idle', color: '#64748b' };
    }
    if (stage < agentIndex + 1) {
      return { status: 'Idle', color: '#64748b' };
    } else if (stage === agentIndex + 1) {
      return { status: 'Processing', color: '#f59e0b' }; // Orange pulsing
    } else {
      return { status: 'Success', color: '#10b981' }; // Green success
    }
  };

  const agentStates = [
    { name: 'InputGuardrailAgent', ...getAgentStatusAndColor(0, streamStage) },
    { name: 'QueryRewriterAgent', ...getAgentStatusAndColor(1, streamStage) },
    { name: 'MultiQueryRetrievalAgent', ...getAgentStatusAndColor(2, streamStage) },
    { name: 'ReRankerAgent', ...getAgentStatusAndColor(3, streamStage) },
    { name: 'AnswerAgent', ...getAgentStatusAndColor(4, streamStage) },
    { name: 'OutputGuardrailAgent', ...getAgentStatusAndColor(5, streamStage) },
  ];

  const handleMenuClick = (event, sess) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setMenuSession(sess);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
    setMenuSession(null);
  };

  const handleRenameClick = () => {
    if (menuSession) {
      setRenameTitle(menuSession.title);
      setRenameOpen(true);
    }
    setMenuAnchor(null);
  };

  const handleRenameSubmit = async () => {
    if (menuSession && renameTitle.trim()) {
      try {
        await renameSession(menuSession.id, renameTitle);
        setRenameOpen(false);
        setRenameTitle('');
        setMenuSession(null);
      } catch (e) {
        alert("Failed to rename chat: " + e.message);
      }
    }
  };

  const handleDeleteClick = async () => {
    if (menuSession) {
      const confirmDelete = window.confirm(t('confirm_delete_chat', 'Are you sure you want to delete this chat session?'));
      if (confirmDelete) {
        try {
          await deleteSession(menuSession.id);
          setMenuAnchor(null);
          setMenuSession(null);
        } catch (e) {
          alert("Failed to delete chat: " + e.message);
        }
      }
    }
  };

  const chatEndRef = useRef(null);
  const autoSubmitRef = useRef(false);

  const activeSessionId = currentSession?.id || 'new';
  const currentTypingUsers = (typingUsers || [])
    .filter(u => u && u.sessionId === activeSessionId)
    .map(u => u.username);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentTypingUsers]);

  useEffect(() => {
    if (activeWorkspace && (activeWorkspace.id === '00000000-0000-0000-0000-000000000000' || isAuthenticated)) {
      fetchSessions();
      fetchDocuments();
    }
  }, [activeWorkspace, isAuthenticated]);

  useEffect(() => {
    if (initialQuery && !autoSubmitRef.current) {
      autoSubmitRef.current = true;
      performSend(initialQuery);
      setInput('');
    }
  }, [initialQuery]);



  const sendTypingStatus = (isTyping) => {
    if (!currentSession) return; // Do not send typing status on the unsaved new chat page
    if (stompClient && stompClient.connected && activeWorkspace) {
      stompClient.publish({
        destination: `/app/workspace/${activeWorkspace.id}/typing`,
        body: JSON.stringify({
          username: user?.displayName || user?.email || 'Guest',
          typing: isTyping,
          sessionId: currentSession.id
        })
      });
    }
  };

  const performSend = async (queryText) => {
    if (!queryText.trim() || isStreaming) return;
    setInput('');

    let session = currentSession;
    if (!session) {
      session = await createSession(queryText.length > 25 ? queryText.substring(0, 25) + '...' : queryText);
    }

    const query = queryText;
    sendTypingStatus(false);
    setStreaming(true);

    clearStageTimers();
    setStreamStage(1); // InputGuardrail active
    stageTimersRef.current.push(setTimeout(() => setStreamStage(2), 800));  // QueryRewriter
    stageTimersRef.current.push(setTimeout(() => setStreamStage(3), 1800)); // MultiQuery
    stageTimersRef.current.push(setTimeout(() => setStreamStage(4), 2800)); // ReRanker
    stageTimersRef.current.push(setTimeout(() => setStreamStage(5), 3800)); // AnswerAgent (streaming)

    addMessage({
      id: Math.random().toString(),
      role: 'user',
      senderName: user?.displayName || user?.email || 'User',
      content: query
    });

    addMessage({
      id: 'stream-placeholder',
      role: 'assistant',
      senderName: 'AI Assistant',
      content: '',
      citations: [],
      explainabilityReport: null
    });

    const displayName = user?.displayName || user?.email || 'Guest User';
    const targetUrl = `/api/chat/stream?query=${encodeURIComponent(query)}&sessionId=${session.id}&userName=${encodeURIComponent(displayName)}`;
    const eventSource = new EventSource(targetUrl);

    let answerAccumulator = '';
    let lastUpdateTime = 0;
    let pendingUpdateTimeout = null;

    eventSource.addEventListener('token', (e) => {
      const data = JSON.parse(e.data);
      if (data.token === '[RESET_STREAM]') {
        answerAccumulator = '';
      } else {
        answerAccumulator += data.token;
      }

      const now = Date.now();
      if (now - lastUpdateTime > 150) {
        updateLastMessageContent(answerAccumulator);
        lastUpdateTime = now;
      } else {
        if (pendingUpdateTimeout) {
          clearTimeout(pendingUpdateTimeout);
        }
        pendingUpdateTimeout = setTimeout(() => {
          updateLastMessageContent(answerAccumulator);
        }, 150);
      }
    });

    eventSource.addEventListener('answer', (e) => {
      const payload = JSON.parse(e.data);
      if (pendingUpdateTimeout) {
        clearTimeout(pendingUpdateTimeout);
        pendingUpdateTimeout = null;
      }

      useStore.setState((state) => {
        const nextMsgs = [...state.messages];
        if (nextMsgs.length > 0) {
          const idx = nextMsgs.findIndex(m => m.id === 'stream-placeholder' || m.id === 'assistant-id');
          if (idx !== -1) {
            nextMsgs[idx] = {
              ...nextMsgs[idx],
              id: 'assistant-id',
              content: payload.answer,
              citations: payload.citations,
              explainabilityReport: payload.explainability_report
            };
          }
        }
        return { messages: nextMsgs };
      });

      eventSource.close();
      setStreaming(false);
      clearStageTimers();
      setStreamStage(6); // OutputGuardrail active
      stageTimersRef.current.push(setTimeout(() => setStreamStage(0), 800)); // Idle
      fetchSessions();

      // Refresh messages to retrieve actual database-generated message IDs (for annotations to work instantly)
      setTimeout(() => {
        const currentSess = useStore.getState().currentSession;
        if (currentSess) {
          api.get(`/api/chat/messages?sessionId=${currentSess.id}`)
            .then(res => useStore.setState({ messages: res.data }))
            .catch(err => console.error("Failed to refresh messages", err));
        }
      }, 600);
    });

    eventSource.addEventListener('cache_hit', (e) => {
      const payload = JSON.parse(e.data);
      if (pendingUpdateTimeout) {
        clearTimeout(pendingUpdateTimeout);
        pendingUpdateTimeout = null;
      }

      useStore.setState((state) => {
        const nextMsgs = [...state.messages];
        if (nextMsgs.length > 0) {
          const idx = nextMsgs.findIndex(m => m.id === 'stream-placeholder' || m.id === 'assistant-id');
          if (idx !== -1) {
            nextMsgs[idx] = {
              ...nextMsgs[idx],
              id: 'assistant-id',
              content: payload.answer,
              citations: payload.citations,
              explainabilityReport: payload.explainability_report
            };
          }
        }
        return { messages: nextMsgs };
      });

      eventSource.close();
      setStreaming(false);
      clearStageTimers();
      setStreamStage(6); // OutputGuardrail active
      stageTimersRef.current.push(setTimeout(() => setStreamStage(0), 800)); // Idle
      fetchSessions();

      // Refresh messages to retrieve actual database-generated message IDs (for annotations to work instantly)
      setTimeout(() => {
        const currentSess = useStore.getState().currentSession;
        if (currentSess) {
          api.get(`/api/chat/messages?sessionId=${currentSess.id}`)
            .then(res => useStore.setState({ messages: res.data }))
            .catch(err => console.error("Failed to refresh messages", err));
        }
      }, 600);
    });

    eventSource.addEventListener('error', (e) => {
      if (pendingUpdateTimeout) {
        clearTimeout(pendingUpdateTimeout);
        pendingUpdateTimeout = null;
      }
      eventSource.close();
      setStreaming(false);
      clearStageTimers();
      setStreamStage(0); // Idle
      updateLastMessageContent(t('stream_error'));
    });
  };

  const handleSend = () => {
    performSend(input);
    setInput('');
  };

  return (
    <Grid container sx={{ flexGrow: 1, height: '100%', overflow: 'hidden' }}>
      {/* Redesigned Sidepanel - Collapsible */}
      <Grid
        item
        sx={{
          width: chatMenuOpen ? 340 : 0,
          minWidth: chatMenuOpen ? 340 : 0,
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1), padding 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-right 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: chatMenuOpen ? '1px solid' : '0px solid transparent',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          p: chatMenuOpen ? 2 : 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Button
            onClick={() => {
              if (messages.length > 0 || !currentSession) {
                createSession();
              }
            }}
            sx={{
              flexGrow: 1,
              height: 36,
              fontSize: '12px',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontWeight: 500,
              '&:hover': { bgcolor: '#ea580c' },
              minWidth: 0,
              overflow: 'hidden'
            }}
          >
            {t('new_chat')}
          </Button>
          <IconButton
            onClick={() => setChatMenuOpen(false)}
            size="small"
            title="Collapse chat menu"
            sx={{
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '4px',
              height: 36,
              width: 36,
              '&:hover': { bgcolor: 'action.hover' }
            }}
          >
            <ChevronLeftIcon sx={{ fontSize: '20px' }} />
          </IconButton>
        </Box>

        {/* Collapsible Documents list */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 1.5,
            cursor: 'pointer'
          }}
          onClick={() => setDocsOpen(!docsOpen)}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              fontSize: '11px',
              color: 'text.disabled',
              letterSpacing: '0.05em'
            }}
          >
            {t('documents').toUpperCase()} ({documents.length})
          </Typography>
          {docsOpen ? (
            <ExpandMoreIcon sx={{ fontSize: '18px', color: 'text.secondary' }} />
          ) : (
            <ChevronRightIcon sx={{ fontSize: '18px', color: 'text.secondary' }} />
          )}
        </Box>

        {docsOpen && (
          <List sx={{ maxHeight: 150, overflowY: 'auto', mb: 2, pr: 0.5 }}>
            {documents.map((doc) => (
              <ListItem
                key={doc.id}
                disablePadding
                sx={{
                  mb: 0.5,
                  borderRadius: '4px',
                  py: 0.5,
                  px: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  bgcolor: 'transparent'
                }}
              >
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: doc.status === 'INDEXED' ? '#10b981' : doc.status === 'PROCESSING' ? '#eab308' : '#ef4444',
                    flexShrink: 0
                  }}
                />
                <ListItemText
                  primary={doc.originalFilename}
                  primaryTypographyProps={{
                    noWrap: true,
                    fontSize: '12px',
                    color: 'text.secondary',
                    fontFamily: 'Inter, sans-serif'
                  }}
                />
              </ListItem>
            ))}
            {documents.length === 0 && (
              <Typography variant="caption" sx={{ color: 'text.disabled', px: 1.5, display: 'block', mb: 1 }}>
                {t('no_docs_uploaded')}
              </Typography>
            )}
          </List>
        )}

        <Divider sx={{ mb: 2, borderColor: 'divider' }} />

        {/* RECENT CHATS list section */}
        <Typography
          variant="caption"
          sx={{
            mb: 1.5,
            fontWeight: 600,
            fontSize: '11px',
            color: 'text.disabled',
            letterSpacing: '0.05em',
            display: 'block'
          }}
        >
          {t('recent_chats').toUpperCase()}
        </Typography>

        <List sx={{ flexGrow: 1, overflowY: 'auto', pr: 0.5, mb: 2 }}>
          {sessions.map((sess) => {
            const isSelected = currentSession?.id === sess.id;
            return (
              <ListItem
                key={sess.id}
                disablePadding
                sx={{ mb: 0.5 }}
                secondaryAction={
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={(e) => handleMenuClick(e, sess)}
                    sx={{
                      color: isSelected ? 'text.primary' : 'text.disabled',
                      opacity: isSelected ? 1 : 0,
                      transition: 'opacity 0.15s ease',
                      '&:hover': { color: 'text.primary' }
                    }}
                    className="session-more-btn"
                  >
                    <MoreIcon sx={{ fontSize: '16px' }} />
                  </IconButton>
                }
                style={{ position: 'relative' }}
                onMouseEnter={(e) => {
                  const btn = e.currentTarget.querySelector('.session-more-btn');
                  if (btn) btn.style.opacity = 1;
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    const btn = e.currentTarget.querySelector('.session-more-btn');
                    if (btn) btn.style.opacity = 0;
                  }
                }}
              >
                <ListItemButton
                  selected={isSelected}
                  onClick={() => setCurrentSession(sess)}
                  sx={{
                    borderRadius: '4px',
                    py: 0.5,
                    px: 1.5,
                    pr: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    borderLeft: isSelected ? '2px solid #f97316' : '2px solid transparent',
                    bgcolor: isSelected ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&.Mui-selected': { bgcolor: 'action.selected' }
                  }}
                >
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: isSelected ? '#f97316' : 'text.disabled'
                    }}
                  />
                  <ListItemText
                    primary={sess.title}
                    primaryTypographyProps={{
                      noWrap: true,
                      fontSize: '12px',
                      color: isSelected ? 'text.primary' : 'text.secondary',
                      fontFamily: 'Inter, sans-serif'
                    }}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>

        <Divider sx={{ my: 1.5, borderColor: 'divider' }} />

        {/* Live Agent Status Accordion/Section */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 1.5,
            cursor: 'pointer'
          }}
          onClick={() => setAgentStatusOpen(!agentStatusOpen)}
        >
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              fontSize: '11px',
              color: 'text.disabled',
              letterSpacing: '0.05em'
            }}
          >
            {t('agent_status', 'Agent Live Status').toUpperCase()}
          </Typography>
          {agentStatusOpen ? (
            <ExpandMoreIcon sx={{ fontSize: '18px', color: 'text.secondary' }} />
          ) : (
            <ChevronRightIcon sx={{ fontSize: '18px', color: 'text.secondary' }} />
          )}
        </Box>

        {agentStatusOpen && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              mb: 2,
              maxHeight: 160,
              overflowY: 'auto',
              pr: 0.5
            }}
          >
            {agentStates.map((agent, idx) => (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: agent.color,
                      animation: agent.status === 'Processing' ? 'pulse 1.2s infinite' : 'none',
                      '@keyframes pulse': {
                        '0%': { opacity: 0.4 },
                        '50%': { opacity: 1 },
                        '100%': { opacity: 0.4 }
                      }
                    }}
                  />
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px' }}>
                    {agent.name}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: agent.color, fontSize: '10px', fontWeight: 600 }}>
                  {agent.status}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        <Divider sx={{ my: 1.5, borderColor: 'divider' }} />

        {/* Presence indicators */}
        <Typography
          variant="caption"
          sx={{
            mb: 1.5,
            fontWeight: 600,
            fontSize: '11px',
            color: 'text.disabled',
            letterSpacing: '0.05em',
            display: 'block'
          }}
        >
          {t('collaborators').toUpperCase()}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            overflowX: 'auto',
            py: 0.5,
            mb: 2,
            '&::-webkit-scrollbar': { display: 'none' },
            msOverflowStyle: 'none',
            scrollbarWidth: 'none'
          }}
        >
          {uniqueCollaborators.map((p, i) => {
            const tooltipTitle = p.displayName && p.email
              ? `${p.displayName} (${p.email})`
              : (p.username || 'Collaborator');
            return (
              <Tooltip key={i} title={tooltipTitle}>
                <Badge overlap="circular" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} variant="dot" color="success">
                  <Avatar sx={{ width: 24, height: 24, bgcolor: 'background.default', color: 'text.primary', border: '1px solid', borderColor: 'divider', fontSize: '10px' }}>
                    {p.username ? p.username[0].toUpperCase() : 'C'}
                  </Avatar>
                </Badge>
              </Tooltip>
            );
          })}
          {uniqueCollaborators.length === 0 && (
            <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '11px' }}>{t('only_you_online')}</Typography>
          )}
        </Box>

        <Divider sx={{ my: 1.5, borderColor: 'divider' }} />

        {/* User Profile Card */}
        {isAuthenticated && user ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: '6px', bgcolor: 'action.hover' }}>
            <Avatar
              sx={{
                width: 30,
                height: 30,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              {(user.displayName || user.email)?.[0].toUpperCase()}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', noWrap: true, fontSize: '12px' }}>
                {user.displayName || user.email.split('@')[0]}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '10px', display: 'block', noWrap: true }}>
                {user.email}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1 }}>
            <Avatar sx={{ width: 30, height: 30, bgcolor: 'background.default', color: 'text.secondary', border: '1px solid', borderColor: 'divider', fontSize: '12px' }}>G</Avatar>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '12px' }}>
                {t('guest_user')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '9px' }}>
                {t('read_only_guest')}
              </Typography>
            </Box>
          </Box>
        )}
      </Grid>

      {/* Main chat window container */}
      <Grid
        item
        xs
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
          position: 'relative'
        }}
      >
        {/* Interactive Chat Page Header */}
        <Box
          sx={{
            height: 56,
            flexShrink: 0,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 3
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {!chatMenuOpen && (
              <IconButton
                onClick={() => setChatMenuOpen(true)}
                sx={{
                  color: 'text.secondary',
                  mr: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '4px',
                  bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
                title="Expand chat menu"
                size="small"
              >
                <ChevronRightIcon sx={{ fontSize: '20px' }} />
              </IconButton>
            )}
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '13px', display: 'flex', alignItems: 'center', gap: 1 }}>
              <CloudIcon sx={{ fontSize: '18px', color: 'primary.main' }} /> {activeWorkspace ? getTranslatedWorkspaceName(activeWorkspace.name) : t('workspace_core')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22c55e' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: '11px' }}>
              {uniqueCollaborators.length > 0 ? `${uniqueCollaborators.length + 1} ${t('online')}` : `1 ${t('online')}`}
            </Typography>
          </Box>
        </Box>

        <Box
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
            pt: 4,
            pb: 12,
            px: { xs: 2, md: 4 },
            width: '100%',
          }}
        >
          <Box sx={{ maxWidth: 1200, mx: 'auto', width: '100%' }}>
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} isStreaming={isStreaming && msg.id === 'stream-placeholder'} />
            ))}

            {messages.length === 0 && (
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '50vh',
                  textAlign: 'center',
                  px: 2,
                  py: 4
                }}
              >
                <Avatar
                  sx={{
                    width: 56,
                    height: 56,
                    bgcolor: 'rgba(249, 115, 22, 0.1)',
                    color: 'primary.main',
                    mb: 2,
                    fontSize: '30px',
                    border: '1px solid rgba(249, 115, 22, 0.2)'
                  }}
                >
                  🤖
                </Avatar>
                <Typography
                  variant="h5"
                  sx={{
                    fontWeight: 700,
                    color: 'text.primary',
                    mb: 1.5,
                    fontSize: '20px',
                    fontFamily: 'Inter, sans-serif'
                  }}
                >
                  {t('welcome_title', { name: getTranslatedWorkspaceName(activeWorkspace?.name) || t('workspace') })}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                    maxWidth: 440,
                    mb: 4,
                    fontSize: '13px',
                    lineHeight: 1.6
                  }}
                >
                  {t('welcome_subtitle', 'Get instant cited answers and insights from your workspace documents. Select one of the quick start queries below or start typing.')}
                </Typography>

                <Grid container spacing={2} sx={{ maxWidth: 640 }}>
                  {[
                    { text: t('suggested_query_1', 'Provide a comprehensive summary of the main points across all uploaded documents.'), desc: t('suggested_query_1_desc', 'Extract key goals, decisions, and action items.') },
                    { text: t('suggested_query_2', 'What are the critical requirements and guidelines specified in our files?'), desc: t('suggested_query_2_desc', 'List recommendations and standards mentioned.') }
                  ].map((q, idx) => (
                    <Grid item xs={12} sm={6} key={idx}>
                      <Button
                        fullWidth
                        variant="outlined"
                        onClick={() => {
                          setInput(q.text);
                          performSend(q.text);
                        }}
                        sx={{
                          py: 1.8,
                          px: 2.5,
                          textTransform: 'none',
                          textAlign: 'left',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          justifyContent: 'center',
                          fontSize: '13px',
                          color: 'text.primary',
                          borderColor: 'divider',
                          borderRadius: '8px',
                          bgcolor: 'background.paper',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                          '&:hover': {
                            borderColor: 'primary.main',
                            bgcolor: 'rgba(249, 115, 22, 0.04)',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                          }
                        }}
                      >
                        <Typography sx={{ fontWeight: 600, fontSize: '13px', color: 'text.primary', mb: 0.5 }}>
                          {q.text}
                        </Typography>
                        <Typography sx={{ fontSize: '11px', color: 'text.secondary' }}>
                          {q.desc}
                        </Typography>
                      </Button>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}

            {/* Real-time typing indicators */}
            {currentTypingUsers.length > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  mt: 1.5,
                  mb: 1.5,
                  pl: 2,
                  animation: 'fadeIn 0.3s ease-in-out',
                  '@keyframes fadeIn': {
                    from: { opacity: 0, transform: 'translateY(4px)' },
                    to: { opacity: 1, transform: 'translateY(0)' }
                  }
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 500,
                    color: 'primary.main',
                    fontSize: '12px',
                    fontFamily: 'Outfit, Inter, sans-serif',
                    letterSpacing: '0.01em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5
                  }}
                >
                  <span>{currentTypingUsers.join(', ')}</span>
                  <span style={{ color: 'text.secondary', fontWeight: 400 }}>
                    {currentTypingUsers.length > 1 ? ' are typing' : ' is typing'}
                  </span>
                </Typography>

                {/* Premium Bouncing Typing Dots */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, height: 10, mt: 0.25 }}>
                  {[0, 1, 2].map((i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        animation: 'typingBounce 1.4s infinite ease-in-out',
                        animationDelay: `${i * 0.2}s`,
                        '@keyframes typingBounce': {
                          '0%, 100%': { transform: 'translateY(0)', opacity: 0.4 },
                          '50%': { transform: 'translateY(-2px)', opacity: 1 }
                        }
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            <div ref={chatEndRef} />
          </Box>
        </Box>

        {/* Input Bar Overlay */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.default',
            py: 2,
            px: { xs: 2, md: 4 }
          }}
        >
          <Box
            sx={{
              maxWidth: 1200,
              mx: 'auto',
              display: 'flex',
              alignItems: 'center',
              height: 48,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '6px',
              px: 2,
              transition: 'border-color 0.15s ease',
              '&:focus-within': {
                borderColor: 'primary.main'
              }
            }}
          >
            <TextField
              fullWidth
              placeholder={t('search_placeholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => sendTypingStatus(true)}
              onBlur={() => sendTypingStatus(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
              }}
              disabled={isStreaming}
              variant="standard"
              InputProps={{
                disableUnderline: true,
                sx: {
                  color: 'text.primary',
                  fontSize: '13px',
                  fontFamily: 'Inter, sans-serif'
                }
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              sx={{
                height: 30,
                fontSize: '11px',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                border: 'none',
                px: 2.5,
                '&:hover': { bgcolor: '#ea580c' },
                '&:disabled': { bgcolor: 'action.disabledBackground', color: 'text.disabled', border: 'none' }
              }}
            >
              {t('send')}
            </Button>
          </Box>
        </Box>
      </Grid>

      {/* Session Actions Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }
        }}
      >
        <MenuItem onClick={handleRenameClick} sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
          <EditIcon sx={{ fontSize: '16px' }} /> {t('rename', 'Rename')}
        </MenuItem>
        <MenuItem onClick={handleDeleteClick} sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <DeleteIcon sx={{ fontSize: '16px', color: 'error.main' }} /> {t('delete', 'Delete')}
        </MenuItem>
      </Menu>

      {/* Rename Chat Dialog */}
      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
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
        <DialogTitle sx={{ fontWeight: 600, fontSize: '15px', borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
          {t('rename_chat', 'Rename Chat')}
        </DialogTitle>
        <DialogContent sx={{ mt: 2, minWidth: 280 }}>
          <TextField
            autoFocus
            margin="dense"
            label={t('chat_title', 'Chat Title')}
            fullWidth
            variant="outlined"
            size="small"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            InputLabelProps={{ sx: { fontSize: '12px', color: 'text.secondary' } }}
            inputProps={{ sx: { fontSize: '13px', color: 'text.primary' } }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button
            onClick={() => setRenameOpen(false)}
            sx={{ height: 28, fontSize: '11px', color: 'text.secondary', border: 'none', '&:hover': { bgcolor: 'action.hover' } }}
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleRenameSubmit}
            variant="contained"
            disabled={!renameTitle.trim()}
            sx={{ height: 28, fontSize: '11px', bgcolor: 'primary.main', color: 'primary.contrastText', '&:hover': { bgcolor: '#ea580c' } }}
          >
            {t('save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
};

export default ChatPage;
