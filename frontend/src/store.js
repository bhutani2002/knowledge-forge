import { create } from 'zustand';
import axios from 'axios';

// Configure default axios instances
export const api = axios.create({
  baseURL: '',
  withCredentials: true, // required to send httpOnly cookies
});

// Module-level promise to prevent duplicate parallel refresh requests
let activeRefreshPromise = null;

// Axios Request Interceptor to generate/propagate custom guest ID
api.interceptors.request.use((config) => {
  let guestId = localStorage.getItem('guestUserId');
  if (!guestId) {
    guestId = 'guest-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('guestUserId', guestId);
  }
  config.headers['X-Guest-Id'] = guestId;
  return config;
});

// Axios Response Interceptor for JWT injection and error handlers
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response && error.response.status === 401 && !originalRequest._retry && originalRequest.url && !originalRequest.url.includes('/api/auth/refresh')) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const res = await axios.post('/api/auth/refresh', { refreshToken });
          const newRefreshToken = res.data.refreshToken;
          localStorage.setItem('refreshToken', newRefreshToken);
          return api(originalRequest); // retry request
        }
      } catch (err) {
        localStorage.removeItem('refreshToken');
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

export const useStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  activeWorkspace: { id: "00000000-0000-0000-0000-000000000000", name: "Public Demo Workspace" },
  workspaces: [],
  documents: [],
  sessions: [],
  currentSession: null,
  messages: [],
  isStreaming: false,
  language: 'en',
  themeMode: 'light',

  setThemeMode: (mode) => {
    document.documentElement.setAttribute('data-theme', mode);
    set({ themeMode: mode });
  },

  setLanguage: (lang) => {
    set({ language: lang });
  },

  // Auth Operations
  restoreSession: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;
    
    if (activeRefreshPromise) {
      return activeRefreshPromise;
    }

    activeRefreshPromise = (async () => {
      try {
        const res = await api.post('/api/auth/refresh', { refreshToken });
        localStorage.setItem('refreshToken', res.data.refreshToken);
        set({ user: res.data, isAuthenticated: true });
        await get().fetchWorkspaces();

        const currentWorkspaces = get().workspaces;
        if (currentWorkspaces.length === 0) {
          await get().createWorkspace("Default Workspace");
        }
        return true;
      } catch (e) {
        console.error("Failed to restore session", e);
        localStorage.removeItem('refreshToken');
        return false;
      } finally {
        activeRefreshPromise = null;
      }
    })();

    return activeRefreshPromise;
  },

  login: async (email, password) => {
    try {
      const res = await api.post('/api/auth/login', { email, password });
      localStorage.setItem('refreshToken', res.data.refreshToken);
      set({ user: res.data, isAuthenticated: true });
      await get().fetchWorkspaces();

      const currentWorkspaces = get().workspaces;
      if (currentWorkspaces.length === 0) {
        await get().createWorkspace("Default Workspace");
      }
      return true;
    } catch (e) {
      throw new Error(e.response?.data?.message || 'Login failed');
    }
  },

  googleLogin: async (credential) => {
    try {
      const res = await api.post('/api/auth/google', { credential });
      localStorage.setItem('refreshToken', res.data.refreshToken);
      set({ user: res.data, isAuthenticated: true });
      await get().fetchWorkspaces();

      const currentWorkspaces = get().workspaces;
      if (currentWorkspaces.length === 0) {
        await get().createWorkspace("Default Workspace");
      }
      return true;
    } catch (e) {
      throw new Error(e.response?.data?.message || 'Google login failed');
    }
  },

  register: async (email, password, displayName) => {
    try {
      await api.post('/api/auth/register', { email, password, displayName });
      return true;
    } catch (e) {
      throw new Error(e.response?.data?.message || 'Registration failed');
    }
  },

  logout: async () => {
    try {
      const token = localStorage.getItem('refreshToken');
      await api.post('/api/auth/logout', { refreshToken: token });
    } catch (e) {
      console.warn("Logout request failed, cleaning local state anyway");
    } finally {
      localStorage.removeItem('refreshToken');
      set({ 
        user: null, 
        isAuthenticated: false, 
        workspaces: [], 
        activeWorkspace: { id: "00000000-0000-0000-0000-000000000000", name: "Public Demo Workspace" } 
      });
      get().fetchDocuments();
      get().fetchSessions();
    }
  },

  // Workspace Operations
  fetchWorkspaces: async () => {
    try {
      const res = await api.get('/api/workspaces');
      set({ workspaces: res.data });
      if (res.data.length > 0 && (!get().activeWorkspace || get().activeWorkspace.id === '00000000-0000-0000-0000-000000000000')) {
        get().setActiveWorkspace(res.data[0]);
      }
    } catch (e) {
      console.error("Failed to load workspaces", e);
    }
  },

  setActiveWorkspace: (workspace) => {
    set({ activeWorkspace: workspace, currentSession: null, messages: [] });
    get().fetchDocuments();
    get().fetchSessions();
  },

  createWorkspace: async (name) => {
    try {
      const res = await api.post('/api/workspaces', { name });
      set((state) => ({ workspaces: [...state.workspaces, res.data] }));
      get().setActiveWorkspace(res.data);
      return res.data;
    } catch (e) {
      throw new Error(e.response?.data?.message || 'Failed to create workspace');
    }
  },

  // Document Operations
  fetchDocuments: async () => {
    const ws = get().activeWorkspace;
    if (!ws) return;
    try {
      const res = await api.get(`/api/docs?workspaceId=${ws.id}`);
      set({ documents: res.data });
    } catch (e) {
      console.error("Failed to fetch documents", e);
    }
  },

  // Chat Operations
  fetchSessions: async () => {
    const ws = get().activeWorkspace;
    const wsId = ws ? ws.id : "00000000-0000-0000-0000-000000000000";
    try {
      const res = await api.get(`/api/chat/sessions?workspaceId=${wsId}`);
      set({ sessions: res.data });
    } catch (e) {
      console.error("Failed to load chat sessions", e);
    }
  },

  setCurrentSession: async (session) => {
    set({ currentSession: session, messages: [] });
    if (session) {
      try {
        const res = await api.get(`/api/chat/messages?sessionId=${session.id}`);
        set({ messages: res.data });
      } catch (e) {
        console.error("Failed to load session messages", e);
      }
    }
  },

  createSession: async (title = "New Chat") => {
    const ws = get().activeWorkspace;
    const wsId = ws ? ws.id : "00000000-0000-0000-0000-000000000000";
    try {
      const res = await api.post('/api/chat/session', { workspaceId: wsId, title });
      set((state) => ({ 
        sessions: [res.data, ...state.sessions],
        currentSession: res.data,
        messages: []
      }));
      return res.data;
    } catch (e) {
      console.error("Failed to create session", e);
    }
  },

  renameSession: async (sessionId, title) => {
    try {
      const res = await api.put(`/api/chat/session/${sessionId}`, { title });
      set((state) => {
        const nextSessions = state.sessions.map((s) => 
          s.id === sessionId ? { ...s, title: res.data.title } : s
        );
        const nextCurrentSession = state.currentSession && state.currentSession.id === sessionId 
          ? { ...state.currentSession, title: res.data.title } 
          : state.currentSession;
        return { sessions: nextSessions, currentSession: nextCurrentSession };
      });
      return true;
    } catch (e) {
      console.error("Failed to rename session", e);
      throw new Error(e.response?.data?.message || 'Failed to rename session');
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await api.delete(`/api/chat/session/${sessionId}`);
      set((state) => {
        const nextSessions = state.sessions.filter((s) => s.id !== sessionId);
        const isCurrentDeleted = state.currentSession && state.currentSession.id === sessionId;
        return {
          sessions: nextSessions,
          currentSession: isCurrentDeleted ? null : state.currentSession,
          messages: isCurrentDeleted ? [] : state.messages
        };
      });
      return true;
    } catch (e) {
      console.error("Failed to delete session", e);
      throw new Error(e.response?.data?.message || 'Failed to delete session');
    }
  },

  addMessage: (msg) => {
    set((state) => ({ messages: [...state.messages, msg] }));
  },

  updateLastMessageContent: (text) => {
    set((state) => {
      const newMsgs = [...state.messages];
      if (newMsgs.length > 0) {
        const last = newMsgs[newMsgs.length - 1];
        if (last.role === 'assistant') {
          last.content = text;
        }
      }
      return { messages: newMsgs };
    });
  },

  setStreaming: (isStreaming) => {
    set({ isStreaming });
  },

  annotateMessage: async (messageId, annotation) => {
    try {
      const res = await api.put(`/api/chat/messages/${messageId}/annotate`, { annotation });
      set((state) => {
        const nextMsgs = state.messages.map((m) => {
          if (m.id === messageId) {
            return { ...m, annotations: res.data.annotations };
          }
          return m;
        });
        return { messages: nextMsgs };
      });
    } catch (e) {
      console.error("Failed to annotate message", e);
      throw new Error(e.response?.data?.message || "Failed to add annotation");
    }
  }
}));
