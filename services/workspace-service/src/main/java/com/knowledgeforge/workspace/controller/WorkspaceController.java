package com.knowledgeforge.workspace.controller;

import com.knowledgeforge.workspace.model.Workspace;
import com.knowledgeforge.workspace.model.WorkspaceMember;
import com.knowledgeforge.workspace.repository.WorkspaceMemberRepository;
import com.knowledgeforge.workspace.repository.WorkspaceRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public WorkspaceController(WorkspaceRepository workspaceRepository, WorkspaceMemberRepository memberRepository) {
        this.workspaceRepository = workspaceRepository;
        this.memberRepository = memberRepository;
    }

    @PostMapping
    public ResponseEntity<?> createWorkspace(
            @RequestBody Map<String, String> body,
            @RequestHeader("X-User-Id") String headerUserIdStr) {
        
        String name = body.get("name");
        if (name == null || name.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Workspace name must not be empty"));
        }

        UUID userId = UUID.fromString(headerUserIdStr);
        Workspace workspace = new Workspace(name, userId);
        workspaceRepository.save(workspace);

        // Add owner as workspace member
        WorkspaceMember member = new WorkspaceMember(workspace.getId(), userId, "WORKSPACE_ADMIN");
        memberRepository.save(member);

        return ResponseEntity.status(HttpStatus.CREATED).body(workspace);
    }

    @GetMapping
    public ResponseEntity<?> listWorkspaces(@RequestHeader("X-User-Id") String headerUserIdStr) {
        UUID userId = UUID.fromString(headerUserIdStr);
        List<WorkspaceMember> memberships = memberRepository.findByUserId(userId);
        
        List<Workspace> workspaces = new ArrayList<>();
        for (WorkspaceMember member : memberships) {
            workspaceRepository.findById(member.getWorkspaceId()).ifPresent(workspaces::add);
        }

        return ResponseEntity.ok(workspaces);
    }

    @PostMapping("/{id}/members")
    public ResponseEntity<?> addMember(
            @PathVariable("id") UUID workspaceId,
            @RequestBody Map<String, String> body) {
        
        String userIdStr = body.get("userId");
        String role = body.getOrDefault("role", "MEMBER");

        if (userIdStr == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "User ID is required"));
        }

        UUID userId = UUID.fromString(userIdStr);
        WorkspaceMember member = new WorkspaceMember(workspaceId, userId, role);
        memberRepository.save(member);

        return ResponseEntity.status(HttpStatus.CREATED).body(member);
    }

    @PostMapping("/{id}/members/invite")
    public ResponseEntity<?> inviteMemberByEmail(
            @PathVariable("id") UUID workspaceId,
            @RequestBody Map<String, String> body,
            @RequestHeader("X-User-Id") String headerUserIdStr) {

        String email = body.get("email");
        if (email == null || email.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Email is required"));
        }

        UUID requesterId = UUID.fromString(headerUserIdStr);
        Optional<Workspace> wsOpt = workspaceRepository.findById(workspaceId);
        if (wsOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", "Workspace not found"));
        }
        Workspace ws = wsOpt.get();
        if (!ws.getOwnerId().equals(requesterId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "Only the workspace owner can invite members"));
        }

        // Find user by email using native query
        List<?> userRows = entityManager.createNativeQuery("SELECT id, email, display_name FROM users WHERE email = :email")
                .setParameter("email", email.trim())
                .getResultList();

        if (userRows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", "User with this email not found"));
        }

        Object[] userRow = (Object[]) userRows.get(0);
        UUID targetUserId = (UUID) userRow[0];

        // Check if already a member
        List<WorkspaceMember> currentMembers = memberRepository.findByWorkspaceId(workspaceId);
        boolean alreadyMember = currentMembers.stream().anyMatch(m -> m.getUserId().equals(targetUserId));
        if (alreadyMember) {
            return ResponseEntity.badRequest().body(Map.of("message", "User is already a member of this workspace"));
        }

        WorkspaceMember member = new WorkspaceMember(workspaceId, targetUserId, "MEMBER");
        memberRepository.save(member);

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "message", "User invited successfully",
                "userId", targetUserId,
                "email", email,
                "displayName", userRow[2] != null ? userRow[2] : ""
        ));
    }

    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<?> removeMember(
            @PathVariable("id") UUID workspaceId,
            @PathVariable("userId") UUID targetUserId,
            @RequestHeader("X-User-Id") String headerUserIdStr) {

        UUID requesterId = UUID.fromString(headerUserIdStr);
        Optional<Workspace> wsOpt = workspaceRepository.findById(workspaceId);
        if (wsOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", "Workspace not found"));
        }
        Workspace ws = wsOpt.get();
        
        // Only owner can remove someone, OR a user can remove themselves (leave workspace)
        if (!ws.getOwnerId().equals(requesterId) && !requesterId.equals(targetUserId)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message", "Only the workspace owner can remove members"));
        }

        if (ws.getOwnerId().equals(targetUserId)) {
            return ResponseEntity.badRequest().body(Map.of("message", "Owner cannot be removed from their own workspace"));
        }

        List<WorkspaceMember> members = memberRepository.findByWorkspaceId(workspaceId);
        Optional<WorkspaceMember> memberOpt = members.stream()
                .filter(m -> m.getUserId().equals(targetUserId))
                .findFirst();

        if (memberOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message", "Member not found in this workspace"));
        }

        memberRepository.delete(memberOpt.get());

        return ResponseEntity.ok(Map.of("message", "Member removed successfully"));
    }

    @GetMapping("/{id}/members")
    public ResponseEntity<?> listMembers(@PathVariable("id") UUID workspaceId) {
        // Fetch all members
        List<WorkspaceMember> members = memberRepository.findByWorkspaceId(workspaceId);
        List<Map<String, Object>> responseList = new ArrayList<>();
        
        for (WorkspaceMember member : members) {
            Map<String, Object> map = new HashMap<>();
            map.put("id", member.getId());
            map.put("workspaceId", member.getWorkspaceId());
            map.put("userId", member.getUserId());
            map.put("role", member.getRole());
            map.put("createdAt", member.getCreatedAt());
            
            // Get user details using native query
            List<?> userRows = entityManager.createNativeQuery("SELECT email, display_name FROM users WHERE id = :id")
                    .setParameter("id", member.getUserId())
                    .getResultList();
            if (!userRows.isEmpty()) {
                Object[] userRow = (Object[]) userRows.get(0);
                map.put("email", userRow[0]);
                map.put("displayName", userRow[1] != null ? userRow[1] : "");
            } else {
                map.put("email", "unknown@knowledgeforge.com");
                map.put("displayName", "Unknown User");
            }
            responseList.add(map);
        }
        
        return ResponseEntity.ok(responseList);
    }
}
