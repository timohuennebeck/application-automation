import { describe, expect, it } from 'vitest';
import { QUEUE_HEADLINE, stepLabel, stepPlan } from '../labels.ts';
import { AgentStepKey, AgentStepStatus } from '../../../src/shared/enums.ts';

const CTX = { company: 'Acme GmbH', source: 'LinkedIn' };

describe('stepPlan', () => {
  it('plans three steps when the posting has a URL', () => {
    const plan = stepPlan(true, CTX);
    expect(plan.map((s) => s.key)).toEqual([AgentStepKey.FETCH, AgentStepKey.EXTRACT, AgentStepKey.COMMENT]);
  });

  it('skips the fetch step for pasted text', () => {
    const plan = stepPlan(false, CTX);
    expect(plan[0].key).toBe(AgentStepKey.EXTRACT);
    expect(plan).toHaveLength(2);
  });

  it('starts every step in its waiting form', () => {
    const plan = stepPlan(true, CTX);
    expect(plan[1].label).toBe('Firmendetails ergänzen');
    expect(plan[2].label).toBe('Abschlusskommentar an {m} hinterlassen');
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

  it('keeps the {m} chip placeholder literal', () => {
    expect(stepLabel(AgentStepKey.COMMENT, AgentStepStatus.DONE, CTX)).toBe(
      'Abschlusskommentar an {m} hinterlassen',
    );
  });

  it('labels a failed step with its infinitive so the row reads as unfinished', () => {
    expect(stepLabel(AgentStepKey.FETCH, AgentStepStatus.ERROR, CTX)).toBe('Stellenanzeige auslesen');
  });

  /* CONTACTS, READ_CV, READ_LETTER, GEN_CV, GEN_LETTER, RATE and VALIDATE are
     no longer planned, but FORMS stays total over the enum so the panel can
     still render a finished row from a run planned before the removal. */
  describe('legacy steps', () => {
    it('closes CONTACTS with a manual-upkeep note instead of the old research wording', () => {
      expect(stepLabel(AgentStepKey.CONTACTS, AgentStepStatus.DONE, CTX)).toBe(
        'Kontaktsuche übersprungen — Kontakte werden manuell gepflegt',
      );
    });

    it('closes READ_CV and READ_LETTER with a manual-creation note, chip placeholder kept literal', () => {
      expect(stepLabel(AgentStepKey.READ_CV, AgentStepStatus.WAIT, CTX)).toBe('Hochgeladenen {doc} einlesen');
      expect(stepLabel(AgentStepKey.READ_CV, AgentStepStatus.DONE, CTX)).toBe(
        'Einlesen übersprungen — Dokumente werden manuell erstellt',
      );
      expect(stepLabel(AgentStepKey.READ_LETTER, AgentStepStatus.DONE, CTX)).toBe(
        'Einlesen übersprungen — Dokumente werden manuell erstellt',
      );
    });

    it('closes GEN_CV and GEN_LETTER with a manual-creation note', () => {
      expect(stepLabel(AgentStepKey.GEN_CV, AgentStepStatus.DONE, CTX)).toBe(
        'Erstellung übersprungen — Lebenslauf wird manuell erstellt',
      );
      expect(stepLabel(AgentStepKey.GEN_LETTER, AgentStepStatus.DONE, CTX)).toBe(
        'Erstellung übersprungen — Anschreiben wird manuell erstellt',
      );
    });

    it('closes RATE and PROOFS noting there is nothing automatic left to check', () => {
      expect(stepLabel(AgentStepKey.RATE, AgentStepStatus.DONE, CTX)).toBe(
        'Bewertung übersprungen — kein automatisch erstelltes Anschreiben',
      );
      expect(stepLabel(AgentStepKey.PROOFS, AgentStepStatus.DONE, CTX)).toBe(
        'Prüfung übersprungen — kein automatisch erstelltes Anschreiben',
      );
    });

    it('closes VALIDATE with a plain skip note', () => {
      expect(stepLabel(AgentStepKey.VALIDATE, AgentStepStatus.DONE, CTX)).toBe('Prüfung übersprungen');
    });
  });
});

describe('headlines', () => {
  it('has a queue headline for runs that have not started', () => {
    expect(QUEUE_HEADLINE).toBe('Kepler wartet in der Warteschlange…');
  });
});
