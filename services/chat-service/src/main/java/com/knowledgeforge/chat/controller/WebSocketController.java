package com.knowledgeforge.chat.controller;

import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;

import java.util.Map;

@Controller
public class WebSocketController {

    // Handles user typing events and broadcasts them
    @MessageMapping("/workspace.{id}.typing")
    @SendTo("/topic/workspace.{id}.typing")
    public Map<String, Object> handleTyping(
            @DestinationVariable("id") String workspaceId,
            @Payload Map<String, Object> payload) {
        
        // Payload contains: username, typing (boolean)
        return Map.of(
                "username", payload.getOrDefault("username", "Unknown User"),
                "typing", payload.getOrDefault("typing", false)
        );
    }

    // Handles user presence (JOIN / LEAVE) and broadcasts them
    @MessageMapping("/workspace.{id}.presence")
    @SendTo("/topic/workspace.{id}.presence")
    public Map<String, Object> handlePresence(
            @DestinationVariable("id") String workspaceId,
            @Payload Map<String, Object> payload) {
        
        // Payload contains: userId, username, action ("JOIN" / "LEAVE")
        return Map.of(
                "userId", payload.getOrDefault("userId", "unknown"),
                "username", payload.getOrDefault("username", "Unknown User"),
                "action", payload.getOrDefault("action", "JOIN")
        );
    }
}
