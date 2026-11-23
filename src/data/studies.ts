export interface StudyCard {
  id: string;
  videoUrl: string;
  titleLines: string;
  metaLines: string;
  tags: string[];
}

export const TAGS: string[] = [
  'All',
  'Light',
  'Physics',
  'Fluids',
  'Grid',
  'Audio',
  'Volumes',
  'Particles',
  'Capture',
  'Render',
];

export const STUDIES: StudyCard[] = [
  {
    id: 'lattices-zone',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/oraciteslArea.mp4',
    titleLines: 'Lattices\nzone',
    metaLines: 'Ambient light\nstudy',
    tags: ['Light', 'Grid', 'Volumes'],
  },
  {
    id: 'prism-shell',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/facet-glass-hero.mp4',
    titleLines: 'Prism\nshell',
    metaLines: 'Dispersion hero\nrender',
    tags: ['Light', 'Volumes', 'Render'],
  },
  {
    id: 'nebular-loop',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/stellarmind-hero.mp4',
    titleLines: 'Nebular\nloop',
    metaLines: 'Procedural hero\nsequence',
    tags: ['Fluids', 'Audio', 'Particles', 'Render'],
  },
  {
    id: 'fall-forward',
    videoUrl: 'https://pub-86dc5b5484314368ac5436a674b0d919.r2.dev/aaaf/thedropthroughArea.mp4',
    titleLines: 'Fall\nforward',
    metaLines: 'Dolly track\nstudy',
    tags: ['Physics', 'Particles', 'Capture'],
  },
];
