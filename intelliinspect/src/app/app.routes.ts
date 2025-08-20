import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DatauploadComponent } from './pages/dataupload/dataupload';

export const routes: Routes = [
  { path: '', redirectTo: 'upload', pathMatch: 'full' },
  { path: 'upload', component: DatauploadComponent }
];

