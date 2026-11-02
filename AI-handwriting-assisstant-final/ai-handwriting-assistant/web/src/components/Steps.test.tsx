import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentContentSchema, type DocumentContent } from '@hw/shared';
import { caps, errorResponse, jsonResponse, mockApi, renderWithProviders } from '../test/utils';
import { StepInput } from './StepInput';
import { StepOrganize } from './StepOrganize';
import { StepReview } from './StepReview';

afterEach(() => vi.unstubAllGlobals());

const content = (patch: Partial<DocumentContent> = {}): DocumentContent => documentContentSchema.parse({ rawText: 'plants make food using light', ...patch });

describe('StepInput', () => {
  it('works fully by typing when voice is unavailable, and disables Next while empty', async () => {
    mockApi({ 'GET /api/health': () => jsonResponse(caps()) });
    const onContent = vi.fn();
    renderWithProviders(<StepInput title="" content={content({ rawText: '' })} onTitle={vi.fn()} onContent={onContent} onNext={vi.fn()} onSkipAi={vi.fn()} />);

    expect(screen.getByRole('button', { name: /next: organize/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your text'), 'a');
    expect(onContent).toHaveBeenCalledWith({ rawText: 'a' });
  });

  it('shows the exam question field only in exam mode, with labelled controls', () => {
    mockApi({ 'GET /api/health': () => jsonResponse(caps()) });
    const props = { title: '', onTitle: vi.fn(), onContent: vi.fn(), onNext: vi.fn(), onSkipAi: vi.fn() };
    const { unmount } = renderWithProviders(<StepInput {...props} content={content({ mode: 'notes' })} />);
    expect(screen.queryByLabelText(/exam question/i)).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<StepInput {...props} content={content({ mode: 'exam' })} />);
    expect(screen.getByLabelText(/exam question/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your answer/i)).toBeInTheDocument();
  });

  it('blocks continuing when the text is over the limit', () => {
    mockApi({ 'GET /api/health': () => jsonResponse(caps()) });
    renderWithProviders(
      <StepInput title="" content={{ ...content(), rawText: 'x'.repeat(20_001) }} onTitle={vi.fn()} onContent={vi.fn()} onNext={vi.fn()} onSkipAi={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /next: organize/i })).toBeDisabled();
    expect(screen.getByText(/too long/i)).toBeInTheDocument();
  });
});

describe('StepOrganize', () => {
  const organized = {
    title: 'Photosynthesis',
    sections: [{ heading: 'Introduction', paragraphs: ['Plants make food using light.'], points: [], ordered: false }],
    changeNotes: [{ kind: 'corrected', description: 'Fixed capitalisation' }],
    addedContent: false,
  };

  it('is upfront that the local formatter does not use AI', async () => {
    mockApi({ 'GET /api/health': () => jsonResponse(caps({ ai: 'local-fallback' })) });
    renderWithProviders(<StepOrganize content={content()} hasTitle onContent={vi.fn()} onTitle={vi.fn()} onDone={vi.fn()} onBack={vi.fn()} />);
    expect(await screen.findByText(/no ai key is configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Format my text' })).toBeInTheDocument();
  });

  it('applies a successful result and moves on', async () => {
    mockApi({
      'GET /api/health': () => jsonResponse(caps({ ai: 'openai' })),
      'POST /api/ai/organize-answer': () =>
        jsonResponse({ organized, text: '# Introduction\nPlants make food using light.', provider: 'openai', model: 'm', promptVersion: 'organize.v1', warnings: [] }),
    });
    const onContent = vi.fn();
    const onDone = vi.fn();
    const onTitle = vi.fn();
    renderWithProviders(<StepOrganize content={content()} hasTitle={false} onContent={onContent} onTitle={onTitle} onDone={onDone} onBack={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Organize with AI' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onContent).toHaveBeenCalledWith(expect.objectContaining({ bodyText: '# Introduction\nPlants make food using light.', aiProvider: 'openai', addedContent: false }));
    expect(onTitle).toHaveBeenCalledWith('Photosynthesis');
  });

  it('on a provider error shows a clear message and never touches the user’s text', async () => {
    mockApi({
      'GET /api/health': () => jsonResponse(caps({ ai: 'openai' })),
      'POST /api/ai/organize-answer': () => errorResponse(429, 'AI_RATE_LIMITED', 'The AI service is busy right now. Wait a minute and try again.'),
    });
    const onContent = vi.fn();
    const onDone = vi.fn();
    renderWithProviders(<StepOrganize content={content()} hasTitle onContent={onContent} onTitle={vi.fn()} onDone={onDone} onBack={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Organize with AI' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/busy right now/i);
    expect(onContent).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('StepReview', () => {
  const props = { onContent: vi.fn(), onBack: vi.fn(), onNext: vi.fn(), onReorganize: vi.fn() };

  it('flags AI-added content prominently and lists what changed', () => {
    renderWithProviders(
      <StepReview
        {...props}
        content={content({
          bodyText: '# Intro\nHello',
          aiProvider: 'openai',
          addedContent: true,
          changeNotes: [{ kind: 'expanded', description: 'Added an example about chloroplasts' }],
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/added content that wasn't in your original/i);
    expect(screen.getByText('Expanded')).toBeInTheDocument();
    expect(screen.getByText(/added an example about chloroplasts/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-organized text - please review/i)).toBeInTheDocument();
  });

  it('labels local formatting as non-AI', () => {
    renderWithProviders(<StepReview {...props} content={content({ bodyText: 'x', aiProvider: 'local-fallback' })} />);
    expect(screen.getByText(/basic formatting only/i)).toBeInTheDocument();
    expect(screen.queryByText(/AI-organized text/i)).not.toBeInTheDocument();
  });

  it('keeps the original available and can restore it', async () => {
    const onContent = vi.fn();
    renderWithProviders(<StepReview {...props} onContent={onContent} content={content({ rawText: 'my original words', bodyText: 'rewritten', aiProvider: 'openai' })} />);
    expect(screen.getByTestId('original-text')).toHaveTextContent('my original words');
    await userEvent.click(screen.getByRole('button', { name: /restore my original text/i }));
    expect(onContent).toHaveBeenCalledWith({ bodyText: 'my original words', changeNotes: [], addedContent: false, aiProvider: null });
  });

  it('requires some text before continuing', () => {
    renderWithProviders(<StepReview {...props} content={content({ bodyText: '   ' })} />);
    expect(screen.getByRole('button', { name: /choose a style/i })).toBeDisabled();
  });
});
