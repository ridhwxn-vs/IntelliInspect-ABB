import { Injectable } from '@angular/core';

export type AllRanges = {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  simStart: string;
  simEnd: string;
};

@Injectable({ providedIn: 'root' })
export class RangeService {

  simStart: string = '';
  simEnd: string = '';

  trainStart: string = '';
  trainEnd: string = '';
  testStart: string = '';
  testEnd: string = '';

  setAllRanges(r: Partial<AllRanges>) {
    if (r.trainStart !== undefined) this.trainStart = r.trainStart;
    if (r.trainEnd   !== undefined) this.trainEnd   = r.trainEnd;
    if (r.testStart  !== undefined) this.testStart  = r.testStart;
    if (r.testEnd    !== undefined) this.testEnd    = r.testEnd;
    if (r.simStart   !== undefined) this.simStart   = r.simStart;
    if (r.simEnd     !== undefined) this.simEnd     = r.simEnd;

    try {
      sessionStorage.setItem('miniml:ranges', JSON.stringify({
        trainStart: this.trainStart,
        trainEnd: this.trainEnd,
        testStart: this.testStart,
        testEnd: this.testEnd,
        simStart: this.simStart,
        simEnd: this.simEnd
      }));
    } catch {}
  }

  getAllRanges(): AllRanges {
    try {
      const raw = sessionStorage.getItem('miniml:ranges');
      if (raw) {
        const r = JSON.parse(raw);
        this.trainStart = r.trainStart || this.trainStart;
        this.trainEnd   = r.trainEnd   || this.trainEnd;
        this.testStart  = r.testStart  || this.testStart;
        this.testEnd    = r.testEnd    || this.testEnd;
        this.simStart   = r.simStart   || this.simStart;
        this.simEnd     = r.simEnd     || this.simEnd;
      }
    } catch {}
    return {
      trainStart: this.trainStart,
      trainEnd: this.trainEnd,
      testStart: this.testStart,
      testEnd: this.testEnd,
      simStart: this.simStart,
      simEnd: this.simEnd
    };
  }
}
