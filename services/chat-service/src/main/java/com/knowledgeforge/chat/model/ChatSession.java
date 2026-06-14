package com.knowledgeforge.chat.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.Date;

@Document(collection = "chat_sessions")
public class ChatSession {

    @Id
    private String id;
    private String workspaceId;
    private String userId;
    private String title;
    private boolean guestSession = false;
    private Date createdAt = new Date();

    public ChatSession() {}

    public ChatSession(String workspaceId, String userId, String title, boolean guestSession) {
        this.workspaceId = workspaceId;
        this.userId = userId;
        this.title = title;
        this.guestSession = guestSession;
    }

    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getWorkspaceId() { return workspaceId; }
    public void setWorkspaceId(String workspaceId) { this.workspaceId = workspaceId; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public boolean isGuestSession() { return guestSession; }
    public void setGuestSession(boolean guestSession) { this.guestSession = guestSession; }
    public Date getCreatedAt() { return createdAt; }
    public void setCreatedAt(Date createdAt) { this.createdAt = createdAt; }
}
