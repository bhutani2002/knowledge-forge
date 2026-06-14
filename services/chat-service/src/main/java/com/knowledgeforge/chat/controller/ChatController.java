package com.knowledgeforge.chat.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.knowledgeforge.chat.model.ChatMessage;
import com.knowledgeforge.chat.model.ChatSession;
import com.knowledgeforge.chat.repository.ChatMessageRepository;
import com.knowledgeforge.chat.repository.ChatSessionRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.scheduler.Schedulers;

import java.util.*;

@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private final ChatSessionRepository sessionRepository;
    private final ChatMessageRepository messageRepository;
    private final WebClient webClient;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ChatController(ChatSessionRepository sessionRepository, ChatMessageRepository messageRepository,
                          @Value("${python.ai.service.url}") String pythonAiUrl) {
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
        this.webClient = WebClient.create(pythonAiUrl);
    }

    @PostMapping("/session")
    public ResponseEntity<ChatSession> createSession(@RequestBody Map<String, String> body,
                                                     @RequestHeader(value = "X-User-Id", required = false) String userId) {
        String workspaceId = body.get("workspaceId");
        String title = body.getOrDefault("title", "New Conversation");
        boolean isGuest = userId == null || "guest-user-id".equals(userId);

        ChatSession session = new ChatSession(workspaceId, userId != null ? userId : "guest-user-id", title, isGuest);
        sessionRepository.save(session);
        return ResponseEntity.ok(session);
    }

    @GetMapping("/sessions")
    public ResponseEntity<List<ChatSession>> getSessions(
            @RequestParam("workspaceId") String workspaceId,
            @RequestHeader(value = "X-User-Id", defaultValue = "guest-user-id") String userId) {
        return ResponseEntity.ok(sessionRepository.findByWorkspaceIdAndUserIdOrderByCreatedAtDesc(workspaceId, userId));
    }

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats(
            @RequestParam("workspaceId") String workspaceId,
            @RequestParam(value = "days", required = false) Integer days,
            @RequestHeader(value = "X-User-Id", defaultValue = "guest-user-id") String userId) {
        List<ChatSession> sessions = sessionRepository.findByWorkspaceIdAndUserIdOrderByCreatedAtDesc(workspaceId, userId);
        if (sessions.isEmpty()) {
            return ResponseEntity.ok(Map.of("queriesCount", 0L, "sessionsCount", 0L));
        }
        
        if (days != null) {
            Calendar cal = Calendar.getInstance();
            cal.add(Calendar.DAY_OF_YEAR, -days);
            Date cutoff = cal.getTime();
            sessions = sessions.stream()
                    .filter(s -> s.getCreatedAt() != null && s.getCreatedAt().after(cutoff))
                    .toList();
        }
        
        if (sessions.isEmpty()) {
            return ResponseEntity.ok(Map.of("queriesCount", 0L, "sessionsCount", 0L));
        }
        List<String> sessionIds = sessions.stream().map(ChatSession::getId).toList();
        long queriesCount = messageRepository.countBySessionIdInAndRole(sessionIds, "user");
        return ResponseEntity.ok(Map.of("queriesCount", queriesCount, "sessionsCount", (long) sessions.size()));
    }

    @GetMapping("/messages")
    public ResponseEntity<List<ChatMessage>> getMessages(@RequestParam("sessionId") String sessionId) {
        return ResponseEntity.ok(messageRepository.findBySessionIdOrderByCreatedAtAsc(sessionId));
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamRagAnswer(
            @RequestParam("query") String query,
            @RequestParam("sessionId") String sessionId,
            @RequestParam(value = "docIds", required = false) String docIds,
            @RequestHeader(value = "X-User-Id", defaultValue = "guest-user-id") String userId,
            @RequestHeader(value = "X-User-Role", defaultValue = "GUEST") String userRole) {

        // 1. Get or create session metadata
        ChatSession session = sessionRepository.findById(sessionId)
                .orElseGet(() -> sessionRepository.save(new ChatSession("00000000-0000-0000-0000-000000000000", userId, "Conversation", "GUEST".equals(userRole))));

        if ("New Conversation".equals(session.getTitle()) || "New Chat".equals(session.getTitle()) || "Conversation".equals(session.getTitle())) {
            String newTitle = query.length() > 30 ? query.substring(0, 27) + "..." : query;
            session.setTitle(newTitle);
            sessionRepository.save(session);
        }

        // 2. Save User message to database
        ChatMessage userMessage = new ChatMessage(sessionId, userId, "User", "user", query);
        messageRepository.save(userMessage);

        // 3. Request python AI service via WebClient and stream tokens
        String encodedQuery = java.net.URLEncoder.encode(query, java.nio.charset.StandardCharsets.UTF_8);
        String targetUrl = String.format("/api/query-stream?query=%s&workspaceId=%s&userId=%s&sessionId=%s%s",
                encodedQuery, session.getWorkspaceId(), userId, sessionId, (docIds != null ? "&docIds=" + docIds : ""));

        // Setup holder to gather response
        final StringBuilder answerBuilder = new StringBuilder();
        final List<Map<String, Object>> citationsHolder = new ArrayList<>();
        final Map<String, Object> reportHolder = new HashMap<>();

        return webClient.get()
                .uri(targetUrl)
                .accept(MediaType.TEXT_EVENT_STREAM)
                .retrieve()
                .bodyToFlux(new org.springframework.core.ParameterizedTypeReference<ServerSentEvent<String>>() {})
                .publishOn(Schedulers.boundedElastic())
                .doOnNext(event -> {
                    String eventType = event.event();
                    String data = event.data();
                    
                    if ("token".equals(eventType)) {
                        try {
                            Map<String, String> tokenMap = objectMapper.readValue(data, new TypeReference<>() {});
                            String token = tokenMap.get("token");
                            if ("[RESET_STREAM]".equals(token)) {
                                answerBuilder.setLength(0); // clear if output guardrail resets
                            } else {
                                answerBuilder.append(token);
                            }
                        } catch (Exception ignored) {}
                    } else if ("answer".equals(eventType) || "cache_hit".equals(eventType)) {
                        try {
                            Map<String, Object> payload = objectMapper.readValue(data, new TypeReference<>() {});
                            String answer = (String) payload.get("answer");
                            List<Map<String, Object>> citations = (List<Map<String, Object>>) payload.get("citations");
                            Map<String, Object> report = (Map<String, Object>) payload.get("explainability_report");
                            
                            if (answer != null) answerBuilder.setLength(0); answerBuilder.append(answer);
                            if (citations != null) citationsHolder.addAll(citations);
                            if (report != null) reportHolder.putAll(report);
                        } catch (Exception ignored) {}
                    }
                })
                .doOnComplete(() -> {
                    // Save assistant message to database when stream completes
                    ChatMessage assistantMessage = new ChatMessage(
                            sessionId,
                            "assistant-id",
                            "AI Assistant",
                            "assistant",
                            answerBuilder.toString()
                    );
                    assistantMessage.setCitations(citationsHolder);
                    assistantMessage.setExplainabilityReport(reportHolder);
                    messageRepository.save(assistantMessage);
                });
    }

    @PutMapping("/messages/{id}/annotate")
    public ResponseEntity<?> addAnnotation(
            @PathVariable("id") String messageId,
            @RequestBody Map<String, String> body) {
        String annotation = body.get("annotation");
        if (annotation == null || annotation.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Annotation text is required"));
        }
        Optional<ChatMessage> msgOpt = messageRepository.findById(messageId);
        if (msgOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        ChatMessage msg = msgOpt.get();
        if (msg.getAnnotations() == null) {
            msg.setAnnotations(new ArrayList<>());
        }
        msg.getAnnotations().add(annotation);
        messageRepository.save(msg);
        return ResponseEntity.ok(msg);
    }

    @PutMapping("/session/{id}")
    public ResponseEntity<ChatSession> renameSession(
            @PathVariable("id") String sessionId,
            @RequestBody Map<String, String> body) {
        String title = body.get("title");
        if (title == null || title.trim().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        Optional<ChatSession> sessionOpt = sessionRepository.findById(sessionId);
        if (sessionOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        ChatSession session = sessionOpt.get();
        session.setTitle(title);
        sessionRepository.save(session);
        return ResponseEntity.ok(session);
    }

    @DeleteMapping("/session/{id}")
    public ResponseEntity<Void> deleteSession(@PathVariable("id") String sessionId) {
        Optional<ChatSession> sessionOpt = sessionRepository.findById(sessionId);
        if (sessionOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        sessionRepository.deleteById(sessionId);
        messageRepository.deleteBySessionId(sessionId);
        return ResponseEntity.noContent().build();
    }
}
