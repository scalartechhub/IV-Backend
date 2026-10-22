import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideAiTurn } from './ai-turn';
import { estimateSpeechSec, SPEECH_FRAME_RMS } from '../../shared/utils/live-transcript';

const base = {
  text: '',
  suppressed: false,
  firstSignalReceived: true,
  awaitingReply: false,
  looksLikeQuestion: false,
  alreadyNudged: false,
  timeWrapSent: false,
  prematureWrap: false,
  canPrompt: true,
};

describe('decideAiTurn — one response per turn', () => {
  it('delivers a question once and then waits for the candidate', () => {
    const decision = decideAiTurn({
      ...base,
      text: 'How does change detection work in Angular?',
      looksLikeQuestion: true,
      awaitingReply: true,
    });
    assert.deepEqual(decision, { action: 'deliver', awaitAnswer: true });
  });

  it('drops a second interviewer turn while that answer is still owed', () => {
    const decision = decideAiTurn({
      ...base,
      text: 'What is a closure in JavaScript?',
      looksLikeQuestion: true,
      suppressed: true,
    });
    assert.equal(decision.action, 'drop');
  });

  it('does not deliver an empty turn as a spoken response', () => {
    const opening = decideAiTurn({ ...base, text: '', firstSignalReceived: false });
    const afterAnswer = decideAiTurn({ ...base, text: '', awaitingReply: true });
    assert.equal(opening.action, 'ignore_empty');
    assert.equal(afterAnswer.action, 'ignore_empty');
  });

  it('asks for the missing question instead of counting short feedback as the reply', () => {
    const decision = decideAiTurn({
      ...base,
      text: 'Not quite.',
      awaitingReply: true,
    });
    assert.equal(decision.action, 'nudge_for_question');
  });

  it('treats one long reply as the single turn even without a question mark', () => {
    const text = 'You covered the render path and the part about signals is the piece I want next';
    const decision = decideAiTurn({
      ...base,
      text,
      awaitingReply: true,
      looksLikeQuestion: false,
    });
    assert.deepEqual(decision, { action: 'deliver', awaitAnswer: true });
  });
});

const frameCount = (seconds: number, sampleRate = 16000): number =>
  Math.floor(sampleRate * seconds);

const pcm = (seconds: number, amplitude: number): Buffer => {
  const samples = frameCount(seconds);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(amplitude * 32767), i * 2);
  }
  return buffer;
};

describe('estimateSpeechSec silence threshold', () => {
  it('counts silence under the RMS floor as no speech', () => {
    const quiet = SPEECH_FRAME_RMS * 0.4;
    assert.equal(estimateSpeechSec(pcm(1, quiet)), 0);
  });

  it('counts audio above the RMS floor as speech', () => {
    const voiced = SPEECH_FRAME_RMS * 3;
    const seconds = estimateSpeechSec(pcm(1, voiced));
    assert.ok(seconds >= 0.9, `expected about 1s of speech, got ${seconds}`);
  });
});
