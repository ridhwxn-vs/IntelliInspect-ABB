import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Daterange } from './daterange';

describe('Daterange', () => {
  let component: Daterange;
  let fixture: ComponentFixture<Daterange>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Daterange]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Daterange);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
