import React from 'react';
import { Box, Typography, Divider, Grid } from '@mui/material';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

const ExplainabilityPanel = ({ report }) => {
  if (!report) return null;

  const {
    query_variants,
    retrieved_chunks,
    chunk_contribution_scores,
    answer_grounding_score,
    cache_hit,
    latency_breakdown
  } = report;

  const chartData = Object.entries(chunk_contribution_scores || {}).map(([id, score], idx) => ({
    name: `Source ${idx + 1}`,
    score: score * 100,
    id: id
  }));

  const getGroundingColor = (score) => {
    if (score >= 80) return '#22c55e';
    if (score >= 55) return '#eab308';
    return '#ef4444';
  };

  return (
    <Box
      sx={{
        mt: 2,
        p: 2.5,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '6px'
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="caption" sx={{ fontWeight: 500, color: 'primary.main', fontSize: '11px', letterSpacing: '0.05em' }}>
          GROUNDING METRICS & TRACE LOG
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {report.retrieval_source && (
            <Box 
              sx={{ 
                border: '1px solid', 
                borderColor: 'primary.main', 
                borderRadius: '4px', 
                px: 1, 
                py: 0.2, 
                color: 'primary.main', 
                fontSize: '10px',
                fontWeight: 500
              }}
            >
              Source: {report.retrieval_source}
            </Box>
          )}
          {cache_hit && (
            <Box sx={{ border: '1px solid', borderColor: 'success.main', borderRadius: '4px', px: 1, py: 0.2, color: 'success.main', fontSize: '10px' }}>
              Cache Hit
            </Box>
          )}
          <Box 
            sx={{ 
              border: `1px solid ${getGroundingColor(answer_grounding_score)}`, 
              borderRadius: '4px', 
              px: 1, 
              py: 0.2, 
              color: getGroundingColor(answer_grounding_score),
              fontSize: '10px',
              fontWeight: 500
            }}
          >
            Grounding: {answer_grounding_score}%
          </Box>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Latency Breakdown */}
        <Grid item xs={12} md={4}>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontWeight: 500, fontSize: '11px', mb: 1.5 }}>
            LATENCY LOGS
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Routing Decision:</Typography>
              <Typography variant="caption" sx={{ color: 'text.primary', fontFamily: 'JetBrains Mono' }}>{latency_breakdown?.routing_ms || 0}ms</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Vector Search:</Typography>
              <Typography variant="caption" sx={{ color: 'text.primary', fontFamily: 'JetBrains Mono' }}>{latency_breakdown?.retrieval_ms || 0}ms</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Cross-Rerank:</Typography>
              <Typography variant="caption" sx={{ color: 'text.primary', fontFamily: 'JetBrains Mono' }}>{latency_breakdown?.rerank_ms || 0}ms</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Generation Response:</Typography>
              <Typography variant="caption" sx={{ color: 'text.primary', fontFamily: 'JetBrains Mono' }}>{latency_breakdown?.generation_ms || 0}ms</Typography>
            </Box>
            <Divider sx={{ my: 0.5, borderColor: 'divider' }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.primary' }}>Total Inferences:</Typography>
              <Typography variant="caption" sx={{ fontWeight: 500, color: 'primary.main', fontFamily: 'JetBrains Mono' }}>
                {(latency_breakdown?.routing_ms || 0) + (latency_breakdown?.retrieval_ms || 0) + (latency_breakdown?.rerank_ms || 0) + (latency_breakdown?.generation_ms || 0)}ms
              </Typography>
            </Box>
          </Box>
        </Grid>

        {/* Query variants */}
        <Grid item xs={12} md={8}>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontWeight: 500, fontSize: '11px', mb: 1.5 }}>
            AGENT EXPANSION QUERY VARIANTS
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {query_variants?.map((v, i) => (
              <Box 
                key={i} 
                sx={{ 
                  p: 1, 
                  bgcolor: 'background.default', 
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '4px' 
                }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic', display: 'block' }}>
                  "{v}"
                </Typography>
              </Box>
            ))}
          </Box>
        </Grid>

        {/* Contribution Chart */}
        {chartData.length > 0 && (
          <Grid item xs={12}>
            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontWeight: 500, fontSize: '11px', mb: 1.5 }}>
              CHUNK CONTRIBUTIONS
            </Typography>
            <Box sx={{ width: '100%', height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: -30, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-3)' }} stroke="var(--color-border)" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-3)' }} domain={[0, 100]} stroke="var(--color-border)" />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px' }} />
                  <Bar dataKey="score" fill="var(--color-border-soft)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Grid>
        )}

        {/* Chunks pre-view details */}
        <Grid item xs={12}>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontWeight: 500, fontSize: '11px', mb: 1.5 }}>
            MATCHED SOURCE DETAILS
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {retrieved_chunks?.map((chunk, i) => (
              <Box
                key={chunk.chunk_id}
                sx={{
                  p: 1.5,
                  bgcolor: 'background.default',
                  borderRadius: '4px',
                  border: '1px solid',
                  borderColor: chunk.used_in_answer ? 'primary.main' : 'divider'
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 500, color: 'primary.main' }}>
                    Source {i + 1}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      Vec: <span style={{ color: 'var(--color-text-1)', fontFamily: 'JetBrains Mono' }}>{chunk.vector_score.toFixed(3)}</span>
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      Rerank: <span style={{ color: 'var(--color-text-1)', fontFamily: 'JetBrains Mono' }}>{chunk.rerank_score.toFixed(3)}</span>
                    </Typography>
                    {chunk.compression_applied && (
                      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '2px', px: 0.5, color: 'text.secondary', fontSize: '9px' }}>
                        Compressed
                      </Box>
                    )}
                    {chunk.used_in_answer && (
                      <Box sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '2px', px: 0.5, color: 'primary.main', fontSize: '9px' }}>
                        Used
                      </Box>
                    )}
                  </Box>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontSize: '11px' }}>
                  {chunk.text_preview}
                </Typography>
              </Box>
            ))}
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ExplainabilityPanel;
