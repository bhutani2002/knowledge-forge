package com.knowledgeforge.document.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.knowledgeforge.document.model.Document;
import com.knowledgeforge.document.repository.DocumentRepository;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import java.util.zip.GZIPOutputStream;
import java.util.zip.GZIPInputStream;

@RestController
@RequestMapping("/api/docs")
public class DocumentController {

    private final DocumentRepository documentRepository;
    private final S3Client s3Client;
    private final RabbitTemplate rabbitTemplate;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${aws.s3.bucket}")
    private String bucketName;

    public DocumentController(DocumentRepository documentRepository, S3Client s3Client,
                              RabbitTemplate rabbitTemplate, StringRedisTemplate redisTemplate) {
        this.documentRepository = documentRepository;
        this.s3Client = s3Client;
        this.rabbitTemplate = rabbitTemplate;
        this.redisTemplate = redisTemplate;
    }

    @GetMapping
    public ResponseEntity<List<Document>> listDocuments(@RequestParam("workspaceId") UUID workspaceId) {
        List<Document> docs = documentRepository.findByWorkspaceId(workspaceId);
        if (docs.isEmpty() && "00000000-0000-0000-0000-000000000000".equals(workspaceId.toString())) {
            Document doc1 = new Document(null, workspaceId, "workspaces/" + workspaceId + "/q3_report.pdf", "Q3 Financial Report.pdf", "hash_q3_financial_report");
            doc1.setStatus("INDEXED");
            documentRepository.save(doc1);
            
            Document doc2 = new Document(null, workspaceId, "workspaces/" + workspaceId + "/roadmap.docx", "Product Roadmap 2025.docx", "hash_product_roadmap_2025");
            doc2.setStatus("INDEXED");
            documentRepository.save(doc2);
            
            Document doc3 = new Document(null, workspaceId, "workspaces/" + workspaceId + "/legal_contract.pdf", "Legal Contract v2.pdf", "hash_legal_contract_v2");
            doc3.setStatus("PROCESSING");
            documentRepository.save(doc3);
            
            Document doc4 = new Document(null, workspaceId, "workspaces/" + workspaceId + "/eng_spec.txt", "Engineering Spec v3.txt", "hash_engineering_spec");
            doc4.setStatus("FAILED");
            documentRepository.save(doc4);

            docs = documentRepository.findByWorkspaceId(workspaceId);
        }
        return ResponseEntity.ok(docs);
    }

    @PostMapping("/upload")
    public ResponseEntity<?> uploadDocument(
            @RequestParam("file") MultipartFile file,
            @RequestParam("workspaceId") UUID workspaceId,
            @RequestHeader(value = "X-User-Id", required = false) String headerUserIdStr,
            @RequestHeader(value = "X-User-Role", required = false) String headerUserRole) {

        if ("GUEST".equalsIgnoreCase(headerUserRole) || headerUserIdStr == null || "guest-user-id".equals(headerUserIdStr)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("message", "Guest users cannot upload documents. Please log in first."));
        }

        UUID userId;
        try {
            userId = UUID.fromString(headerUserIdStr);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("message", "Invalid user ID."));
        }

        // 1. Validation: Types, Size (< 50MB)
        String originalFilename = file.getOriginalFilename();
        if (originalFilename == null) {
            return ResponseEntity.badRequest().body(Map.of("message", "Filename must not be empty"));
        }
        
        String ext = originalFilename.substring(originalFilename.lastIndexOf(".")).toLowerCase();
        if (!Arrays.asList(".pdf", ".docx", ".txt").contains(ext)) {
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                    .body(Map.of("message", "Only PDF, DOCX, and TXT files are supported."));
        }

        if (file.getSize() > 50L * 1024 * 1024) {
            return ResponseEntity.badRequest().body(Map.of("message", "File size exceeds limit of 50MB"));
        }

        // ClamAV Mock Virus Scan stub
        boolean virusDetected = scanMockClamAV(file);
        if (virusDetected) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("message", "Virus scanner flagged this file as malicious."));
        }

        try {
            byte[] fileBytes = file.getBytes();
            String fileHash = computeSHA256(fileBytes);

            // 2. Check if already exists in this workspace
            Optional<Document> existingDoc = documentRepository.findByWorkspaceIdAndFileHash(workspaceId, fileHash);
            if (existingDoc.isPresent()) {
                Document d = existingDoc.get();
                if ("INDEXED".equals(d.getStatus()) || "PROCESSING".equals(d.getStatus())) {
                    return ResponseEntity.ok(Map.of("status", "ALREADY_INDEXED", "fileHash", fileHash));
                }
                // If it failed earlier, we delete the failed record so we can retry indexing!
                documentRepository.delete(d);
            }

            // 3. GZIP Compress file bytes
            byte[] compressedBytes = compressGzip(fileBytes);

            // 4. Upload compressed to S3 / MinIO
            String s3Key = "workspaces/" + workspaceId + "/" + UUID.randomUUID() + ext;
            PutObjectRequest putRequest = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(s3Key)
                    .contentEncoding("gzip")
                    .contentType(file.getContentType())
                    .build();

            s3Client.putObject(putRequest, RequestBody.fromBytes(compressedBytes));

            // 5. Store Metadata in Postgres
            Document doc = new Document(userId, workspaceId, s3Key, originalFilename, fileHash);
            documentRepository.save(doc);

            // 6. Publish job to RabbitMQ queue: document.ingest
            String idempotencyKey = computeSHA256((doc.getId().toString() + fileHash).getBytes());
            Map<String, Object> jobMsg = new HashMap<>();
            jobMsg.put("doc_id", doc.getId().toString());
            jobMsg.put("s3_key", s3Key);
            jobMsg.put("user_id", userId.toString());
            jobMsg.put("workspace_id", workspaceId.toString());
            jobMsg.put("idempotency_key", idempotencyKey);
            jobMsg.put("filename", originalFilename);

            rabbitTemplate.convertAndSend("document.ingest", objectMapper.writeValueAsString(jobMsg));


            return ResponseEntity.ok(Map.of(
                    "status", "PENDING",
                    "docId", doc.getId(),
                    "filename", originalFilename,
                    "fileHash", fileHash
            ));

        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Document upload and processing failed: " + e.getMessage()));
        }
    }

    private boolean scanMockClamAV(MultipartFile file) {
        // Virus scan stub returning false (all clear)
        return false;
    }

    private byte[] compressGzip(byte[] data) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(bos)) {
            gzip.write(data);
        }
        return bos.toByteArray();
    }

    private String computeSHA256(byte[] data) throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(data);
        StringBuilder hexString = new StringBuilder();
        for (byte b : hash) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) hexString.append('0');
            hexString.append(hex);
        }
        return hexString.toString();
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<byte[]> downloadDocument(@PathVariable("id") UUID id) {
        Optional<Document> docOpt = documentRepository.findById(id);
        if (docOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        Document doc = docOpt.get();
        try {
            ResponseBytes<GetObjectResponse> s3Object = s3Client.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(bucketName)
                    .key(doc.getS3Key())
                    .build());
            
            byte[] fileBytes = s3Object.asByteArray();
            
            byte[] decompressedBytes = fileBytes;
            if (doc.getS3Key().endsWith(".gz") || "gzip".equals(s3Object.response().contentEncoding())) {
                try (GZIPInputStream gis = new GZIPInputStream(new ByteArrayInputStream(fileBytes))) {
                    decompressedBytes = gis.readAllBytes();
                } catch (Exception ignored) {}
            }
            
            return ResponseEntity.ok()
                    .header("Content-Disposition", "attachment; filename=\"" + doc.getOriginalFilename() + "\"")
                    .body(decompressedBytes);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
