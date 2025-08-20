import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../api.service';

type UploadMeta = {
  fileKey: string;
  fileName: string;
  records: number;
  columns: number;
  passRate: number;          // 0-100
  startDate: string;         // ISO or "yyyy-MM-dd HH:mm:ss"
  endDate: string;
  hasTimestamp: boolean;
};

@Component({
  selector: 'app-dataupload',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dataupload.html',
  styleUrls: ['./dataupload.css']
})
export class DatauploadComponent {
  fileName = '';
  fileSize = 0;              // KB
  isDragging = false;
  isUploading = false;
  errorMsg = '';
  analysisDone = false;
  userConfirmed = false;

  metadata: Partial<UploadMeta> = {};

  constructor(private api: ApiService) {}

  // ============ Drag & Drop ============
  onDragOver(ev: DragEvent) {
    ev.preventDefault();
    this.isDragging = true;
  }
  onDragLeave(ev: DragEvent) {
    ev.preventDefault();
    this.isDragging = false;
  }
  onDrop(ev: DragEvent) {
    ev.preventDefault();
    this.isDragging = false;
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
      this.handleFile(ev.dataTransfer.files[0]);
    }
  }

  // ============ File chooser ============
  onFileSelected(event: any) {
    const file: File = event?.target?.files?.[0];
    if (file) this.handleFile(file);
  }

  // ============ Core handler ============
  private handleFile(file: File) {
    this.resetState();

    // Frontend validation — CSV only
    const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
    if (!isCsv) {
      this.errorMsg = 'Please upload a .csv file.';
      return;
    }

    this.fileName = file.name;
    this.fileSize = +(file.size / 1024).toFixed(1); // KB
    this.isUploading = true;

    this.api.uploadDataset(file).subscribe({
      next: (res: UploadMeta) => {
        this.isUploading = false;
        this.errorMsg = '';

        // Persist fileKey and dataset bounds for later pages
        this.api.setCurrentFileKey(res.fileKey);
        this.api.setDatasetBounds(res.startDate, res.endDate);   // ✅ ADDED

        // Bind metadata to UI
        this.metadata = {
          fileKey: res.fileKey,
          fileName: res.fileName,
          records: res.records,
          columns: res.columns,
          passRate: res.passRate,
          startDate: res.startDate,
          endDate: res.endDate,
          hasTimestamp: res.hasTimestamp
        };

        this.analysisDone = true;
      },
      error: (err) => {
        this.isUploading = false;
        console.error('Upload failed:', err);
        this.errorMsg = (err?.error?.message) || 'Upload failed. Please try again.';
      }
    });
  }

  private resetState() {
    this.errorMsg = '';
    this.analysisDone = false;
    this.userConfirmed = false;
    this.metadata = {};
  }
}
