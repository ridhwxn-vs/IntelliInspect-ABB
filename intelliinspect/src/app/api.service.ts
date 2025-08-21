import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';

export interface UploadResponse {
  fileKey: string;
  fileName: string;
  records: number;
  columns: number;
  passRate: number;
  startDate: string;
  endDate: string;
  hasTimestamp: boolean;
}

export interface TrainResponse {
  accuracy: number;
  precision: number;
  recall: number;
  f1score: number;
  confusion: { tp: number; tn: number; fp: number; fn: number };
  history: {
    epochs: number[];
    train_accuracy: number[]; 
    train_logloss: number[];
  };
}

@Injectable({ providedIn: 'root' })
export class ApiService 
{
  private baseUrl = 'http://localhost:5159';

  private fileKey$ = new BehaviorSubject<string | null>(
    typeof window !== 'undefined' ? sessionStorage.getItem('miniml:fileKey') : null
  );

  constructor(private http: HttpClient) {}

  uploadDataset(file: File): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<UploadResponse>(`${this.baseUrl}/upload-dataset`, formData);
  }

  setCurrentFileKey(key: string) {
    this.fileKey$.next(key);
    try { sessionStorage.setItem('miniml:fileKey', key); } catch {}
  }

  getCurrentFileKey(): string | null {
    return this.fileKey$.value;
  }

  setDatasetBounds(startDate: string, endDate: string) 
  {
    try {
      sessionStorage.setItem('miniml:startDate', startDate);
      sessionStorage.setItem('miniml:endDate', endDate);
    } catch {}
  }

  getDatasetBounds(): { startDate: string; endDate: string } | null {
    try {
      const startDate = sessionStorage.getItem('miniml:startDate') || '';
      const endDate = sessionStorage.getItem('miniml:endDate') || '';
      if (!startDate || !endDate) return null;
      return { startDate, endDate };
    } catch {
      return null;
    }
  }

  trainModel(payload: { fileKey: string; trainStart: string; trainEnd: string; testStart: string;  testEnd: string;}) 
  {
    return this.http.post<TrainResponse>(`${this.baseUrl}/train-model`, payload);
  }

}
