import { describe, expect, it } from 'vitest';
import { PROOFS_REWRITE_LABEL, QUEUE_HEADLINE, stepLabel, stepPlan } from '../labels.ts';
import { AgentStepKey, AgentStepStatus, TemplateKind } from '../../../src/shared/enums.ts';

const CTX = { company: 'Acme GmbH', source: 'LinkedIn' };

describe('stepPlan', () => {
  it('plans all ten steps when the posting has a URL', () => {
    const plan = stepPlan(true, CTX);
    expect(plan.map((s) => s.key)).toEqual([
      AgentStepKey.FETCH,
      AgentStepKey.EXTRACT,
      AgentStepKey.CONTACTS,
      AgentStepKey.READ_CV,
      AgentStepKey.READ_LETTER,
      AgentStepKey.GEN_CV,
      AgentStepKey.GEN_LETTER,
      AgentStepKey.PROOFS,
      AgentStepKey.VALIDATE,
      AgentStepKey.COMMENT,
    ]);
    expect(plan[3].doc).toBe(TemplateKind.LEBENSLAUF);
    expect(plan[4].doc).toBe(TemplateKind.ANSCHREIBEN);
  });

  it('skips the fetch step for pasted text', () => {
    const plan = stepPlan(false, CTX);
    expect(plan[0].key).toBe(AgentStepKey.EXTRACT);
    expect(plan).toHaveLength(9);
  });

  it('starts every step in its waiting form', () => {
    const plan = stepPlan(true, CTX);
    expect(plan[1].label).toBe('Firmendetails ergänzen');
    expect(plan[9].label).toBe('Kommentar an {m} mit Bewerbungslink hinterlassen');
  });
});

describe('stepLabel', () => {
  it('renders the three grammatical forms the mock used', () => {
    expect(stepLabel(AgentStepKey.EXTRACT, AgentStepStatus.WAIT, CTX)).toBe('Firmendetails ergänzen');
    expect(stepLabel(AgentStepKey.EXTRACT, AgentStepStatus.RUN, CTX)).toBe('Firmendetails werden ergänzt…');
    expect(stepLabel(AgentStepKey.EXTRACT, AgentStepStatus.DONE, CTX)).toBe('Firmendetails ergänzt');
  });

  it('names the posting source while fetching', () => {
    expect(stepLabel(AgentStepKey.FETCH, AgentStepStatus.RUN, CTX)).toBe(
      'LinkedIn-Stellenanzeige wird ausgelesen…',
    );
    expect(stepLabel(AgentStepKey.FETCH, AgentStepStatus.DONE, CTX)).toBe(
      'Stellenanzeige auf LinkedIn ausgelesen',
    );
    expect(stepLabel(AgentStepKey.FETCH, AgentStepStatus.DONE, { ...CTX, source: 'Karriereseite' })).toBe(
      'Stellenanzeige auf der Karriereseite ausgelesen',
    );
    expect(stepLabel(AgentStepKey.FETCH, AgentStepStatus.RUN, { ...CTX, source: '' })).toBe(
      'Stellenanzeige wird ausgelesen…',
    );
  });

  it('puts the company name into the document steps', () => {
    expect(stepLabel(AgentStepKey.GEN_CV, AgentStepStatus.WAIT, CTX)).toBe(
      'Lebenslauf für Acme GmbH erstellen',
    );
    expect(stepLabel(AgentStepKey.GEN_CV, AgentStepStatus.RUN, CTX)).toBe(
      'Lebenslauf für Acme GmbH wird erstellt…',
    );
    expect(stepLabel(AgentStepKey.GEN_LETTER, AgentStepStatus.DONE, CTX)).toBe(
      'Anschreiben für Acme GmbH erstellt',
    );
  });

  it('keeps the chip placeholders literal', () => {
    expect(stepLabel(AgentStepKey.READ_CV, AgentStepStatus.WAIT, CTX)).toBe('Hochgeladenen {doc} einlesen');
    expect(stepLabel(AgentStepKey.READ_CV, AgentStepStatus.DONE, CTX)).toBe('Hochgeladenen {doc} eingelesen');
    expect(stepLabel(AgentStepKey.COMMENT, AgentStepStatus.DONE, CTX)).toBe(
      'Kommentar an {m} mit Bewerbungslink hinterlassen',
    );
  });

  it('labels a failed step with its infinitive so the row reads as unfinished', () => {
    expect(stepLabel(AgentStepKey.FETCH, AgentStepStatus.ERROR, CTX)).toBe('Stellenanzeige auslesen');
  });
});

describe('headlines', () => {
  it('has a queue headline for runs that have not started', () => {
    expect(QUEUE_HEADLINE).toBe('Kepler wartet in der Warteschlange…');
  });
});

describe('the proofs step', () => {
  const ctx = { company: 'Helios Energie', source: 'LinkedIn' };

  it('reads in all three forms', () => {
    expect(stepLabel(AgentStepKey.PROOFS, AgentStepStatus.WAIT, ctx)).toBe('Belege prüfen');
    expect(stepLabel(AgentStepKey.PROOFS, AgentStepStatus.RUN, ctx)).toBe('Belege werden geprüft…');
    expect(stepLabel(AgentStepKey.PROOFS, AgentStepStatus.DONE, ctx)).toBe('Belege geprüft');
  });

  it('sits between the letter and the format check', () => {
    /* It reads the finished documents, so it cannot run before them; and what
       it finds has to reach the closing comment, so it cannot run after it. */
    const keys = stepPlan(true, ctx).map((s) => s.key);

    expect(keys.indexOf(AgentStepKey.PROOFS)).toBe(keys.indexOf(AgentStepKey.GEN_LETTER) + 1);
    expect(keys.indexOf(AgentStepKey.VALIDATE)).toBe(keys.indexOf(AgentStepKey.PROOFS) + 1);
  });

  it('says so while it is rewriting, rather than hiding it under “prüfen”', () => {
    expect(PROOFS_REWRITE_LABEL).toContain('neu geschrieben');
  });
});
