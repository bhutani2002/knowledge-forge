package com.knowledgeforge.notification.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class NotificationConsumer {

    private static final Logger logger = LoggerFactory.getLogger(NotificationConsumer.class);
    private final JavaMailSender mailSender;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public NotificationConsumer(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    @KafkaListener(topics = "doc.indexed", groupId = "notification-group")
    public void consumeDocIndexed(String message) {
        logger.info("Received Kafka doc.indexed event: {}", message);
        try {
            Map<String, Object> payload = objectMapper.readValue(message, new TypeReference<>() {});
            String docId = (String) payload.get("doc_id");
            String filename = (String) payload.get("filename");
            String status = (String) payload.get("status");

            // Build and send email notification
            SimpleMailMessage mail = new SimpleMailMessage();
            mail.setFrom("noreply@knowledgeforge.com");
            mail.setTo("user@knowledgeforge.com"); // Static user for demo
            mail.setSubject("KnowledgeForge - Document Status Update");
            mail.setText(String.format("Hello,\n\nYour document '%s' processing status has completed with: %s.\n\nBest regards,\nKnowledgeForge Team",
                    filename, status));
            
            mailSender.send(mail);
            logger.info("Email notification successfully sent for document {}", docId);
        } catch (Exception e) {
            logger.error("Failed to parse/process doc.indexed event: {}", e.getMessage());
        }
    }

    @KafkaListener(topics = "report.scheduled", groupId = "notification-group")
    public void consumeReportScheduled(String message) {
        logger.info("Received Kafka report.scheduled trigger: {}", message);
        try {
            Map<String, Object> payload = objectMapper.readValue(message, new TypeReference<>() {});
            String reportId = (String) payload.get("report_id");
            String workspaceId = (String) payload.get("workspace_id");

            SimpleMailMessage mail = new SimpleMailMessage();
            mail.setFrom("noreply@knowledgeforge.com");
            mail.setTo("workspace-admin@knowledgeforge.com");
            mail.setSubject("KnowledgeForge - Weekly Intelligence Report");
            mail.setText(String.format("Hello,\n\nYour weekly intelligence report (ID: %s) for workspace %s has been compiled.\n\nSummary:\n- New documents processed: 12\n- Key topics detected: Distributed Systems, Redis Cache, RAG Pipelines\n- Grounding average score: 96.5%%\n\nBest regards,\nKnowledgeForge Team",
                    reportId, workspaceId));
            
            mailSender.send(mail);
            logger.info("Weekly Intelligence Report email sent successfully.");
        } catch (Exception e) {
            logger.error("Failed to process report.scheduled event: {}", e.getMessage());
        }
    }
}
