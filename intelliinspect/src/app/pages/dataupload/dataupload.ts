import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../api.service';   

@Component({
  selector: 'app-dataupload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dataupload.html',
  styleUrls: ['./dataupload.css']
})
export class DatauploadComponent {
  fileName: string = '';
  fileSize: number = 0;
  metadata: any = {};

  constructor(private api: ApiService) {}

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (file) {
      this.fileName = file.name;
      this.fileSize = +(file.size / 1024).toFixed(1);

      this.api.uploadDataset(file).subscribe({
        next: (res) => {
          console.log('API Response:', res);
          this.metadata = res;   
        },
        error: (err) => {
          console.error('Upload failed:', err);
        }
      });
    }
  }
}
