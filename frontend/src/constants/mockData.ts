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

export interface ArticleDetail {
  id: string;
  name: string;
  category: string;
  call_count: number;
  last_updated: string;
  trigger_phrases: string[];
  conversation_flow: ConversationStep[];
  clarifying_questions: ClarifyingQuestion[];
  exceptions: Exception[];
  services_and_prices: ServicePrice[];
  red_flags: RedFlag[];
  never_say: string[];
  faq: FAQ[];
  evidence: Evidence[];
}

export const ARTICLE_DETAILS: Record<string, ArticleDetail> = {
  cat_sterilization: {
    id: "cat_sterilization",
    name: "Стерилизация кошки",
    category: "preventive",
    call_count: 12,
    last_updated: "1 мар 2026",
    trigger_phrases: [
      "хотим стерилизовать кошку",
      "сколько стоит стерилизация",
      "кошку нужно кастрировать",
      "когда лучше стерилизовать",
      "подготовка к стерилизации",
    ],
    conversation_flow: [
      {
        step: "Выяснить возраст и породу",
        ask: "Сколько вашей кошечке лет и какая порода?",
        why: "Возраст влияет на риски анестезии, порода — на доп. обследования",
      },
      {
        step: "Уточнить состояние здоровья",
        ask: "Есть ли хронические заболевания? Прививки сделаны?",
        why: "Прививки должны быть актуальны, хронические заболевания — доп. подготовка",
      },
      {
        step: "Объяснить подготовку",
        say: "Перед операцией нужна голодная диета 8-12 часов. Воду можно давать за 4 часа до.",
      },
      {
        step: "Назвать стоимость и что входит",
        say: "Стерилизация кошки — 5500 рублей. В стоимость входит: наркоз, операция, послеоперационная попона, наблюдение в клинике 2 часа.",
      },
      {
        step: "Предложить дату",
        action: "check_slots",
        doctor_role: "хирург",
        say: "Давайте подберём удобную дату. У нас есть...",
      },
      {
        step: "Подтвердить запись",
        say: "Записала вас на {дата} в {время}. Не забудьте про голодную диету!",
      },
    ],
    clarifying_questions: [
      {
        question: "Кошка уже рожала?",
        why: "У рожавших кошек операция сложнее, стоимость может отличаться",
        impact: "Если рожала — предупредить о возможной более высокой цене",
      },
      {
        question: "Кошка сейчас не в течке?",
        why: "Во время течки операцию лучше отложить на 2 недели",
        impact: "Если в течке — перенести запись",
      },
      {
        question: "Есть ли непереносимость наркоза в анамнезе?",
        why: "Редкий случай, но критически важный",
        impact: "Если да — дополнительная консультация анестезиолога",
      },
    ],
    exceptions: [
      {
        condition: "Порода мейн-кун",
        action: "Добавить ЭКГ и УЗИ сердца перед операцией (риск ГКМП)",
        price_impact: "+2000₽ за кардиообследование",
      },
      {
        condition: "Кошка старше 8 лет",
        action: "Обязательный биохимический анализ крови перед операцией",
        price_impact: "+1200₽ за анализ",
      },
      {
        condition: "Кошка на свободном выгуле",
        action: "Уточнить дату последней дегельминтизации, возможно нужна перед операцией",
        price_impact: "+500₽ если нужна обработка",
      },
    ],
    services_and_prices: [
      {
        service: "Стерилизация кошки",
        price: 5500,
        currency: "₽",
        includes: "наркоз, операция, попона, наблюдение 2ч",
        mandatory: true,
      },
      {
        service: "ЭКГ",
        price: 1500,
        currency: "₽",
        mandatory: false,
        condition: "Для пород группы риска (мейн-кун, британская, шотландская)",
      },
      {
        service: "УЗИ сердца",
        price: 2600,
        currency: "₽",
        mandatory: false,
        condition: "Для пород группы риска",
      },
      {
        service: "Биохимический анализ крови",
        price: 1200,
        currency: "₽",
        mandatory: false,
        condition: "Кошки старше 8 лет",
      },
    ],
    red_flags: [
      {
        signal: "Кошка беременна",
        action: "Не записывать на стандартную стерилизацию. Перевести на ветеринара для обсуждения.",
        urgency: "urgent",
      },
      {
        signal: "Кошка после операции плохо себя чувствует (звонок post-op)",
        action: "Немедленно соединить с дежурным ветеринаром.",
        urgency: "emergency",
      },
    ],
    never_say: [
      "Не обещать конкретный исход операции",
      "Не говорить «это безопасная операция» — любая операция имеет риски",
      "Не давать медицинских рекомендаций по подготовке сверх стандартных",
      "Не сравнивать цены с другими клиниками",
    ],
    faq: [
      {
        q: "В каком возрасте лучше стерилизовать?",
        a: "Оптимально с 7-8 месяцев. Но можно и позже — ветеринар оценит на приёме.",
      },
      {
        q: "Кошка будет толстеть после стерилизации?",
        a: "Гормональный фон меняется, но при правильном питании вес контролируется. Врач даст рекомендации.",
      },
      {
        q: "Как быстро она восстановится?",
        a: "Обычно 7-10 дней. Швы снимают через 10-14 дней, если не саморассасывающиеся.",
      },
      {
        q: "Нужно ли оставлять на ночь?",
        a: "Обычно нет, через 2 часа после операции можно забирать. Но если хотите — можем оставить на стационар.",
      },
    ],
    evidence: [
      {
        call_id: "2026-01-24_14-05-18_9602355445_411331575",
        quote: "Стерилизация кошки у нас стоит 5500 рублей, туда входит наркоз, сама операция, попонка послеоперационная",
        timestamp_sec: 145.2,
      },
      {
        call_id: "2026-02-05_11-19-32_9039624835_424195916",
        quote: "Если мейн-кун, то мы рекомендуем перед операцией сделать ЭКГ, потому что у них бывает кардиомиопатия",
        timestamp_sec: 203.7,
      },
      {
        call_id: "2026-02-16_14-40-40_9777152573_436127698",
        quote: "Голодная диета минимум 8 часов перед операцией, водичку можно за 4 часа убрать",
        timestamp_sec: 89.1,
      },
    ],
  },
};
