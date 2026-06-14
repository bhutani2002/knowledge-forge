package com.knowledgeforge.chat.repository;

import com.knowledgeforge.chat.model.ChatSession;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ChatSessionRepository extends MongoRepository<ChatSession, String> {
    List<ChatSession> findByWorkspaceIdOrderByCreatedAtDesc(String workspaceId);
    List<ChatSession> findByWorkspaceIdAndUserIdOrderByCreatedAtDesc(String workspaceId, String userId);
}
