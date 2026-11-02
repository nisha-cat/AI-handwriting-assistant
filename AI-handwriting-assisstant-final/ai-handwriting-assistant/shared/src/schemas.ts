import { z } from 'zod';

/** Hard limits shared by the client (early feedback) and the server (enforcement). */
export const LIMITS = {
  maxInputChars: 20_000,
  maxBodyChars: 40_000,
  maxQuestionChars: 1_000,
  maxTitleChars: 120,
  maxPages: 60,
  maxLinesPerPage: 120,
  maxLineChars: 600,
} as const;

// ---------------------------------------------------------------------------
// Handwriting settings
// ---------------------------------------------------------------------------

export const HANDWRITING_STYLE_IDS = ['caveat', 'kalam', 'patrick'] as const;
export const PAPER_TYPES = ['ruled', 'grid', 'blank'] as const;
export const PAGE_SIZES = ['a4', 'letter'] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #1f3fa0');

export const handwritingSettingsSchema = z.object({
  style: z.enum(HANDWRITING_STYLE_IDS).default('caveat'),
  paper: z.enum(PAPER_TYPES).default('ruled'),
  pageSize: z.enum(PAGE_SIZES).default('a4'),
  inkColor: hexColor.default('#1f3fa0'),
  /** Font size in PostScript points. */
  fontSize: z.number().min(10).max(32).default(18),
  /** Distance between ruled lines in points. Clamped up to fit the font size. */
  lineSpacing: z.number().min(16).max(48).default(26),
  /** Page margins in points (72pt = 1 inch). */
  margins: z
    .object({
      top: z.number().min(24).max(144).default(64),
      right: z.number().min(24).max(144).default(48),
      bottom: z.number().min(36).max(144).default(60),
      left: z.number().min(24).max(144).default(64),
    })
    .default({ top: 64, right: 48, bottom: 60, left: 64 }),
  showTitle: z.boolean().default(true),
  showDate: z.boolean().default(false),
  pageNumbers: z.boolean().default(true),
  /** 0 = perfectly regular, 1 = noticeable (still legible) variation. */
  naturalness: z.number().min(0).max(1).default(0.4),
  /** Seed for the deterministic variation so preview and export match. */
  seed: z.number().int().min(0).max(1_000_000).default(7),
});
export type HandwritingSettings = z.infer<typeof handwritingSettingsSchema>;

export const defaultHandwritingSettings = (): HandwritingSettings => handwritingSettingsSchema.parse({});

// ---------------------------------------------------------------------------
// AI answer organisation
// ---------------------------------------------------------------------------

export const TASK_MODES = [
  'exam_answer',
  'short_notes',
  'detailed_explanation',
  'summary',
  'qa_format',
  'bullet_revision',
] as const;
export type TaskMode = (typeof TASK_MODES)[number];

export const TASK_MODE_LABELS: Record<TaskMode, string> = {
  exam_answer: 'Exam answer',
  short_notes: 'Short notes',
  detailed_explanation: 'Detailed explanation',
  summary: 'Summary',
  qa_format: 'Question-and-answer',
  bullet_revision: 'Bullet-point revision notes',
};

export const ANSWER_LENGTHS = ['short', 'medium', 'long'] as const;
export const DETAIL_LEVELS = ['concise', 'balanced', 'thorough'] as const;

export const answerStructureSchema = z.object({
  introduction: z.boolean().default(true),
  mainPoints: z.boolean().default(true),
  examples: z.boolean().default(false),
  conclusion: z.boolean().default(true),
});
export type AnswerStructure = z.infer<typeof answerStructureSchema>;

export const organizeRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Add some text to organise first.')
    .max(LIMITS.maxInputChars, `Text is too long (max ${LIMITS.maxInputChars} characters).`),
  mode: z.enum(TASK_MODES).default('exam_answer'),
  question: z.string().trim().max(LIMITS.maxQuestionChars).default(''),
  subject: z.string().trim().max(120).default(''),
  level: z.string().trim().max(120).default(''),
  length: z.enum(ANSWER_LENGTHS).default('medium'),
  detail: z.enum(DETAIL_LEVELS).default('balanced'),
  language: z.string().trim().min(2).max(40).default('English'),
  structure: answerStructureSchema.default({ introduction: true, mainPoints: true, examples: false, conclusion: true }),
});
export type OrganizeRequest = z.infer<typeof organizeRequestSchema>;

export const CHANGE_KINDS = ['corrected', 'reorganized', 'expanded', 'removed'] as const;
export const changeNoteSchema = z.object({
  kind: z.enum(CHANGE_KINDS),
  description: z.string().trim().min(1).max(300),
});
export type ChangeNote = z.infer<typeof changeNoteSchema>;

export const organizedSectionSchema = z.object({
  heading: z.string().trim().max(200).default(''),
  paragraphs: z.array(z.string().trim().min(1).max(4000)).max(30).default([]),
  points: z.array(z.string().trim().min(1).max(1000)).max(40).default([]),
  /** true → points are rendered as a numbered list, false → bullets. */
  ordered: z.boolean().default(false),
});
export type OrganizedSection = z.infer<typeof organizedSectionSchema>;

/** The structured output every AI provider must return (validated server-side). */
export const organizedAnswerSchema = z.object({
  title: z.string().trim().max(LIMITS.maxTitleChars).default(''),
  sections: z.array(organizedSectionSchema).min(1).max(30),
  changeNotes: z.array(changeNoteSchema).max(20).default([]),
  /** True when the model added information that was not in the user's text. */
  addedContent: z.boolean().default(false),
});
export type OrganizedAnswer = z.infer<typeof organizedAnswerSchema>;

export interface OrganizeResponse {
  organized: OrganizedAnswer;
  /** Editable markup rendering of `organized` (see markup.ts). */
  text: string;
  provider: 'openai' | 'local-fallback';
  model: string | null;
  promptVersion: string;
  /** Non-fatal notes for the user, e.g. "numbers not present in your original". */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentContentSchema = z.object({
  mode: z.enum(['notes', 'exam']).default('notes'),
  question: z.string().max(LIMITS.maxQuestionChars).default(''),
  subject: z.string().max(120).default(''),
  level: z.string().max(120).default(''),
  taskMode: z.enum(TASK_MODES).default('exam_answer'),
  length: z.enum(ANSWER_LENGTHS).default('medium'),
  detail: z.enum(DETAIL_LEVELS).default('balanced'),
  language: z.string().max(40).default('English'),
  structure: answerStructureSchema.default({ introduction: true, mainPoints: true, examples: false, conclusion: true }),
  /** What the user dictated/typed. Never overwritten by the AI step. */
  rawText: z.string().max(LIMITS.maxInputChars).default(''),
  /** The reviewed text that gets rendered as handwriting. */
  bodyText: z.string().max(LIMITS.maxBodyChars).default(''),
  changeNotes: z.array(changeNoteSchema).max(20).default([]),
  addedContent: z.boolean().default(false),
  aiProvider: z.enum(['openai', 'local-fallback']).nullable().default(null),
  settings: handwritingSettingsSchema.default(() => defaultHandwritingSettings()),
});
export type DocumentContent = z.infer<typeof documentContentSchema>;

export const documentInputSchema = z.object({
  title: z.string().trim().min(1, 'Give the document a title.').max(LIMITS.maxTitleChars),
  content: documentContentSchema,
});
export type DocumentInput = z.infer<typeof documentInputSchema>;

export const documentPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(LIMITS.maxTitleChars).optional(),
    content: documentContentSchema.optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, 'Nothing to update.');
export type DocumentPatch = z.infer<typeof documentPatchSchema>;

export interface DocumentSummary {
  id: string;
  title: string;
  mode: 'notes' | 'exam';
  excerpt: string;
  createdAt: string;
  updatedAt: string;
}
export interface DocumentRecord extends DocumentSummary {
  version: number;
  content: DocumentContent;
}
export interface DocumentVersionSummary {
  version: number;
  title: string;
  createdAt: string;
}

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const preferencesSchema = z.object({
  settings: handwritingSettingsSchema,
});
export type Preferences = z.infer<typeof preferencesSchema>;

// ---------------------------------------------------------------------------
// Layout (shared by the canvas renderer and the PDF exporter)
// ---------------------------------------------------------------------------

export const layoutLineSchema = z.object({
  text: z.string().max(LIMITS.maxLineChars),
  x: z.number().min(0).max(2000),
  /** Baseline, measured from the top of the page in points. */
  y: z.number().min(0).max(2000),
  fontSize: z.number().min(4).max(72),
  /** Degrees, clockwise-positive (canvas convention). */
  rotation: z.number().min(-5).max(5),
  /** Width in points, used for underlines. */
  width: z.number().min(0).max(2000),
  kind: z.enum(['body', 'heading', 'title', 'date', 'marker', 'pageNumber']),
  underline: z.boolean().default(false),
});
export type LayoutLine = z.infer<typeof layoutLineSchema>;

export const layoutSchema = z.object({
  pageWidth: z.number().min(200).max(1000),
  pageHeight: z.number().min(200).max(1400),
  style: z.enum(HANDWRITING_STYLE_IDS),
  paper: z.enum(PAPER_TYPES),
  inkColor: hexColor,
  /** Distance between ruled lines. */
  pitch: z.number().min(10).max(80),
  /** Y of the top of the first writing row. */
  gridTop: z.number().min(0).max(1000),
  rows: z.number().int().min(1).max(200),
  marginLeft: z.number().min(0).max(300),
  marginRight: z.number().min(0).max(300),
  pages: z
    .array(z.object({ lines: z.array(layoutLineSchema).max(LIMITS.maxLinesPerPage * 3) }))
    .min(1)
    .max(LIMITS.maxPages),
});
export type Layout = z.infer<typeof layoutSchema>;

export const exportPdfRequestSchema = z.object({
  title: z.string().trim().max(LIMITS.maxTitleChars).default('notes'),
  layout: layoutSchema,
});
export type ExportPdfRequest = z.infer<typeof exportPdfRequestSchema>;

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Capabilities {
  status: 'ok';
  store: 'mysql' | 'memory';
  ai: 'openai' | 'local-fallback';
  transcription: boolean;
  maxAudioMb: number;
}
