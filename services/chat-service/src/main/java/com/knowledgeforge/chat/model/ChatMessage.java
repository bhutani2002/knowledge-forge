package com.knowledgeforge.chat.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.Date;
import java.util.List;
import java.util.Map;

@Document(collection = "chat_messages")
public class ChatMessage {

    @Id
    private String id;
    private String sessionId;
    private String senderId;
    private String senderName;
    private String role; // "user" or "assistant"
    private String content;
    private List<Map<String, Object>> citations;
    private Map<String, Object> explainabilityReport;
    private List<String> annotations = new java.util.ArrayList<>();
    private Date createdAt = new Date();

    public ChatMessage() {}

    public ChatMessage(String sessionId, String senderId, String senderName, String role, String content) {
        this.sessionId = sessionId;
        this.senderId = senderId;
        this.senderName = senderName;
        this.role = role;
        this.content = content;
    }

    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public String getSenderId() { return senderId; }
    public void setSenderId(String senderId) { this.senderId = senderId; }
    public String getSenderName() { return senderName; }
    public void setSenderName(String senderName) { this.senderName = senderName; }
    public String getRole() { return role; }
    public void setRole(String role) { this.role = role; }
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    public List<Map<String, Object>> getCitations() { return citations; }
    public void setCitations(List<Map<String, Object>> citations) { this.citations = citations; }
    public Map<String, Object> getExplainabilityReport() { return explainabilityReport; }
    public void setExplainabilityReport(Map<String, Object> explainabilityReport) { this.explainabilityReport = explainabilityReport; }
    public Date getCreatedAt() { return createdAt; }
    public void setCreatedAt(Date createdAt) { this.createdAt = createdAt; }
    public List<String> getAnnotations() { return annotations; }
    public void setAnnotations(List<String> annotations) { this.annotations = annotations; }
}
