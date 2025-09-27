package pipeline

const segmentationPrompt = `You are an expert at analyzing veterinary clinic phone call transcripts in Russian.

Given a transcript of a phone call to a veterinary clinic, split it into logical topic segments.
Each segment should cover ONE distinct topic discussed during the call.

For each segment, provide:
- topic: a short descriptive title in Russian
- text: the exact portion of the transcript covering this topic
- urgency: one of "emergency", "urgent", "routine", "informational"
- category: suggested category (e.g. "preventive", "emergency", "urological", "admin", "surgical", "dermatological", "dental", "diagnostic")
- suggested_slug: a URL-friendly slug in English (e.g. "cat_sterilization", "dog_vaccination")
- suggested_name: full article name in Russian

IMPORTANT: Do NOT create segments for greetings or goodbyes. Focus on substantive topics.

Return ONLY a valid JSON array, no markdown code fences, no extra text.
Example:
[
  {
    "topic": "Стерилизация кошки",
    "text": "Здравствуйте, хотели бы записать кошку на стерилизацию...",
    "urgency": "routine",
    "category": "preventive",
    "suggested_slug": "cat_sterilization",
    "suggested_name": "Стерилизация кошки"
  }
]

Transcript:
%s`

const enrichArticlePrompt = `You are a veterinary knowledge base editor.

You have an existing knowledge base article and a new segment from a phone call transcript.
Update the article's content JSON by incorporating new information from the segment.

Rules:
- Add new trigger_phrases if the segment reveals phrases not already present
- Add new conversation_flow steps if the segment shows a workflow not covered
- Add new clarifying_questions, exceptions, services_and_prices, red_flags, faq entries as appropriate
- Add an evidence entry with a key quote from the segment
- Do NOT remove existing information
- Do NOT duplicate existing entries
- Keep the same JSON structure

Current article name: %s
Current content:
%s

New segment from call:
%s

Return ONLY the updated content JSON, no markdown code fences, no extra text.`

const createArticlePrompt = `You are a veterinary knowledge base editor.

Create a new knowledge base article from a phone call transcript segment.

The article content should follow this exact JSON structure:
{
  "trigger_phrases": ["phrase1", "phrase2"],
  "conversation_flow": [
    {"step": "Step description", "ask": "Question to ask", "why": "Reason"},
    {"step": "Step description", "say": "What to say"}
  ],
  "clarifying_questions": [
    {"question": "...", "why": "...", "impact": "..."}
  ],
  "exceptions": [
    {"condition": "...", "action": "...", "price_impact": "..."}
  ],
  "services_and_prices": [
    {"service": "...", "price": 0, "currency": "₽", "mandatory": true}
  ],
  "red_flags": [
    {"signal": "...", "action": "...", "urgency": "urgent"}
  ],
  "never_say": ["..."],
  "faq": [
    {"q": "...", "a": "..."}
  ],
  "evidence": [
    {"quote": "...", "source": "call_transcript"}
  ]
}

Fill in as much as possible from the segment. Leave arrays empty if no relevant info.

Topic: %s
Category: %s

Segment text:
%s

Return ONLY the content JSON, no markdown code fences, no extra text.`
