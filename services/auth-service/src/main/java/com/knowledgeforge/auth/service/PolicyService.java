package com.knowledgeforge.auth.service;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

@Service
public class PolicyService {

    public void evaluateQueryDocumentPolicy(Map<String, Object> user, Map<String, Object> document) {
        String role = (String) user.getOrDefault("role", "GUEST");
        String tier = (String) user.getOrDefault("tier", "FREE");
        String userId = (String) user.get("id");
        
        String docOwnerId = (String) document.get("owner_id");
        String docVisibility = (String) document.getOrDefault("visibility", "PRIVATE");
        
        // 1. GUEST cannot query normal documents (only public / demo corpus)
        if ("GUEST".equalsIgnoreCase(role)) {
            if (!"PUBLIC".equalsIgnoreCase(docVisibility)) {
                throw new AccessDeniedException("Guest users are only authorized to query the public demo corpus.");
            }
            return;
        }

        // 2. Admin has access to everything
        if ("ADMIN".equalsIgnoreCase(role)) {
            return;
        }

        // 3. User checks: Must own the doc or have workspace access
        if ("PRIVATE".equalsIgnoreCase(docVisibility) && !userId.equals(docOwnerId)) {
            throw new AccessDeniedException("Access denied to private document.");
        }

        // 4. Rate checks based on Tier
        int dailyLimit = "PRO".equalsIgnoreCase(tier) ? 1000 : 50;
        int currentCount = (Integer) user.getOrDefault("daily_query_count", 0);
        if (currentCount >= dailyLimit) {
            throw new AccessDeniedException("Daily RAG query limit exceeded for " + tier + " tier.");
        }
    }

    public void evaluateUploadDocumentPolicy(Map<String, Object> user, Map<String, Object> workspace) {
        String role = (String) user.getOrDefault("role", "GUEST");
        String tier = (String) user.getOrDefault("tier", "FREE");

        // 1. Check roles allowed to upload
        List<String> allowedRoles = Arrays.asList("USER", "WORKSPACE_ADMIN", "ADMIN");
        if (!allowedRoles.contains(role.toUpperCase())) {
            throw new AccessDeniedException("Role " + role + " is not authorized to upload documents.");
        }

        // 2. Storage Limit checks
        long maxStorageBytes = "PRO".equalsIgnoreCase(tier) ? 10L * 1024 * 1024 * 1024 : 100L * 1024 * 1024; // PRO = 10GB, FREE = 100MB
        long currentStorageBytes = (Long) user.getOrDefault("storage_used", 0L);
        if (currentStorageBytes >= maxStorageBytes) {
            throw new AccessDeniedException("Storage limit exceeded for " + tier + " tier.");
        }
    }
}
