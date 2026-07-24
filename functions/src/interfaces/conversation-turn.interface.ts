// Mirrors src/app/interfaces/conversation-turn.interface.ts � keep in sync
export type Speaker = 'ai' | 'user';
export type Sentiment = 'confident' | 'neutral' | 'hesitant';
export type QuestionType = 'technical' | 'behavioral' | 'follow_up' | 'clarifying';

/** Path: interviews/{interviewId}/conversation/{turnId} */
export interface ConversationTurn {
  turnIndex: number;
  speaker: Speaker;
  timestampOffsetMs: number;
  text: string;
  audioStoragePath?: string;
  sentiment?: Sentiment;
  questionType?: QuestionType;
  /** Duplicated for security rules / collectionGroup — architecture §3 */
  userId?: string;
}
