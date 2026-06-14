import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, api } from '../store';

export default function AuthCallback() {
  const navigate = useNavigate();
  const setUser = useStore((s) => s.setUser || ((user) => s.setState ? s.setState({ user, isAuthenticated: true }) : null));

  useEffect(() => {
    // Fetch profile since Spring Boot auth success handler has written jwt_token cookie
    api.get('/api/auth/me')
      .then((res) => {
        // Set user in Zustand store directly
        useStore.setState({ user: res.data, isAuthenticated: true });
        // Auto-create default workspace if needed
        const workspaces = useStore.getState().workspaces;
        if (workspaces.length === 0) {
          useStore.getState().fetchWorkspaces().then(() => {
             const ws = useStore.getState().workspaces;
             if (ws.length === 0) {
               useStore.getState().createWorkspace("Default Workspace").then(() => {
                 navigate('/chat');
               });
             } else {
               navigate('/chat');
             }
          });
        } else {
          navigate('/chat');
        }
      })
      .catch((err) => {
        console.error("OAuth profile fetch failed", err);
        navigate('/?error=oauth_failed');
      });
  }, [navigate]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '80vh',
      backgroundColor: '#0f0f0f',
      color: '#fafaf9',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        fontSize: '14px',
        color: '#a8a29e',
        letterSpacing: '0.05em'
      }}>
        SIGNING YOU IN...
      </div>
    </div>
  );
}
