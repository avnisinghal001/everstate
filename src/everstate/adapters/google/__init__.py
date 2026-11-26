"""Google Cloud adapters.

    vertex         Vertex AI embeddings (gemini-embedding-001 / -2, text-embedding-005)
                   and Gemini generation through the google-genai SDK
    spanner        Spanner as system of record + colocated ANN vector index
                   (ARRAY<FLOAT32>(vector_length=>N), CREATE VECTOR INDEX, APPROX_COSINE_DISTANCE)
    firestore      Firestore store + find_nearest vector search (≤2048-d)
    bigquery       BigQuery append-only event log (analytics, consolidation input)
    vector_search  Vertex AI Vector Search (index endpoint, streaming upserts, namespace filters)

Credentials come from Application Default Credentials (ADC) everywhere.
"""
