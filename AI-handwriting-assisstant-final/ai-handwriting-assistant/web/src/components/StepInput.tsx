import { LIMITS, type DocumentContent } from '@hw/shared';
import { countWords } from '../lib/format';
import { appendText } from '../lib/voice';
import { useToast } from './Toasts';
import { VoiceInput } from './VoiceInput';

interface Props {
  title: string;
  content: DocumentContent;
  onTitle: (t: string) => void;
  onContent: (patch: Partial<DocumentContent>) => void;
  onNext: () => void;
  onSkipAi: () => void;
}

export function StepInput({ title, content, onTitle, onContent, onNext, onSkipAi }: Props) {
  const toast = useToast();
  const isExam = content.mode === 'exam';
  const words = countWords(content.rawText);
  const tooLong = content.rawText.length > LIMITS.maxInputChars;
  const empty = content.rawText.trim().length === 0;

  const addSpoken = (text: string) => {
    const { text: next, truncated } = appendText(content.rawText, text, LIMITS.maxInputChars);
    onContent({ rawText: next });
    if (truncated) toast.error(`Your answer reached the ${LIMITS.maxInputChars.toLocaleString()}-character limit, so the end of the dictation was dropped.`);
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="doc-title" className="label">
          Title
        </label>
        <input id="doc-title" className="field" value={title} maxLength={LIMITS.maxTitleChars} placeholder="e.g. Photosynthesis - Biology" onChange={(e) => onTitle(e.target.value)} />
        <p className="hint">Shown at the top of page 1 (you can turn that off later).</p>
      </div>

      {isExam && (
        <div>
          <label htmlFor="exam-question" className="label">
            1. Exam question
          </label>
          <textarea
            id="exam-question"
            className="field min-h-20"
            maxLength={LIMITS.maxQuestionChars}
            value={content.question}
            onChange={(e) => onContent({ question: e.target.value })}
            placeholder="Paste or type the question you are answering"
          />
        </div>
      )}

      <VoiceInput language={content.language} onText={addSpoken} />

      <div>
        <label htmlFor="raw-text" className="label">
          {isExam ? '2. Your answer' : 'Your text'}
        </label>
        <textarea
          id="raw-text"
          className="field min-h-56 font-sans leading-relaxed"
          value={content.rawText}
          aria-describedby="raw-text-count"
          onChange={(e) => onContent({ rawText: e.target.value })}
          placeholder="Type, paste or dictate here. You can edit everything before it becomes handwriting."
        />
        <p id="raw-text-count" className={`hint ${tooLong ? 'font-semibold text-red-700' : ''}`}>
          {words} words · {content.rawText.length.toLocaleString()} / {LIMITS.maxInputChars.toLocaleString()} characters
          {tooLong && ' - too long; shorten it to continue.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" disabled={empty || tooLong} onClick={onNext}>
          Next: organize with AI →
        </button>
        <button type="button" className="btn-secondary" disabled={empty || tooLong} onClick={onSkipAi}>
          Skip AI - use my text as written
        </button>
      </div>
    </div>
  );
}
