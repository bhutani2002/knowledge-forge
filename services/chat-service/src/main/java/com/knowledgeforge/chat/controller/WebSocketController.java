package com.knowledgeforge.chat.controller;

import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Map;

@Controller
public class WebSocketController {

    private final SimpMessagingTemplate messagingTemplate;

    public WebSocketController(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    // Handles user typing events and broadcasts them
    @MessageMapping("/workspace/{id}/typing")
    public void handleTyping(
            @DestinationVariable("id") String workspaceId,
            @Payload Map<String, Object> payload) {
        
        Map<String, Object> response = Map.of(
                "username", payload.getOrDefault("username", "Unknown User"),
                "typing", payload.getOrDefault("typing", false),
                "sessionId", payload.getOrDefault("sessionId", "new")
        );
        messagingTemplate.convertAndSend("/topic/workspace/" + workspaceId + "/typing", response);
    }

    // Handles user presence (JOIN / LEAVE) and broadcasts them
    @MessageMapping("/workspace/{id}/presence")
    public void handlePresence(
            @DestinationVariable("id") String workspaceId,
            @Payload Map<String, Object> payload) {
        
        Map<String, Object> response = Map.of(
                "userId", payload.getOrDefault("userId", "unknown"),
                "username", payload.getOrDefault("username", "Unknown User"),
                "displayName", payload.getOrDefault("displayName", ""),
                "email", payload.getOrDefault("email", ""),
                "action", payload.getOrDefault("action", "JOIN"),
                "isReply", payload.getOrDefault("isReply", false)
        );
        messagingTemplate.convertAndSend("/topic/workspace/" + workspaceId + "/presence", response);
    }
}
