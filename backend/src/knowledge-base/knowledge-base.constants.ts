/**
 * pgvector cosine distance `<=>`: 0 = identical, 2 = opposite.
 * If the best matching chunk is farther than this, we treat the question as
 * not covered by the KB (escalate + do not inject irrelevant chunks into the prompt).
 */
export const KB_VECTOR_DISTANCE_THRESHOLD = 0.42;
