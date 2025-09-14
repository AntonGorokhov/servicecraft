export interface ConversationStep {
  step: string;
  ask?: string;
  say?: string;
  why?: string;
  action?: string;
  doctor_role?: string;
}

export interface ClarifyingQuestion {
  question: string;
  why: string;
  impact: string;
}

export interface Exception {
  condition: string;
  action: string;
  price_impact: string;
}

export interface ServicePrice {
  service: string;
  price: number;
  currency: string;
  includes?: string;
  mandatory: boolean;
  condition?: string;
}

export interface RedFlag {
  signal: string;
  action: string;
  urgency: "urgent" | "emergency";
}

export interface FAQ {
  q: string;
  a: string;
}

export interface Evidence {
  call_id: string;
  quote: string;
  timestamp_sec: number;
}

export interface Article {
  id: number;
  slug: string;
  name: string;
  category: string;
  call_count: number;
  steps: number;
  exceptions: number;
  last_updated: string;
  company_id: number | null;
}

export interface ArticleContent {
  trigger_phrases?: string[];
  conversation_flow?: ConversationStep[];
  clarifying_questions?: ClarifyingQuestion[];
  exceptions?: Exception[];
  services_and_prices?: ServicePrice[];
  red_flags?: RedFlag[];
  never_say?: string[];
  faq?: FAQ[];
  evidence?: Evidence[];
}

export interface ArticleDetail extends Article {
  content: ArticleContent;
}
