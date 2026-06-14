package com.knowledgeforge.notification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
public class ScheduledReportTask {

    private static final Logger logger = LoggerFactory.getLogger(ScheduledReportTask.class);
    private final StringRedisTemplate redisTemplate;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final String instanceId = UUID.randomUUID().toString();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ScheduledReportTask(StringRedisTemplate redisTemplate, KafkaTemplate<String, String> kafkaTemplate) {
        this.redisTemplate = redisTemplate;
        this.kafkaTemplate = kafkaTemplate;
    }

    // Cron triggers every Sunday at midnight. For testing we also schedule it to run every 5 minutes.
    @Scheduled(cron = "0 0 0 * * SUN")
    @Scheduled(cron = "0 */5 * * * *") // Run every 5 minutes for local testing/verification
    public void generateWeeklyReports() {
        String lockKey = "report:lock:weekly";
        logger.info("Instance {} attempting lock acquisition for weekly report task...", instanceId);

        // Leader Election via Redis SETNX (setIfAbsent) with 70s expiry
        Boolean lockAcquired = redisTemplate.opsForValue().setIfAbsent(lockKey, instanceId, Duration.ofSeconds(70));

        if (Boolean.TRUE.equals(lockAcquired)) {
            logger.info("Leader elected! Instance {} acquired report generation lock.", instanceId);
            try {
                executeReportGeneration();
            } catch (Exception e) {
                logger.error("Report generation task failed: {}", e.getMessage());
            }
        } else {
            logger.info("Instance {} failed to acquire lock (another node is executing report generation).", instanceId);
        }
    }

    private void executeReportGeneration() throws Exception {
        // Build report scheduled event
        String reportId = UUID.randomUUID().toString();
        String workspaceId = UUID.randomUUID().toString(); // Mock workspace ID

        Map<String, String> eventPayload = new HashMap<>();
        eventPayload.put("report_id", reportId);
        eventPayload.put("workspace_id", workspaceId);
        eventPayload.put("status", "TRIGGERED");

        String payloadJson = objectMapper.writeValueAsString(eventPayload);
        kafkaTemplate.send("report.scheduled", reportId, payloadJson);
        logger.info("Published report.scheduled event to Kafka for report {}", reportId);
    }
}
