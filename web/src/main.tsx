import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppV2 } from './v2/AppV2.tsx';
import { Gallery } from './v2/Gallery.tsx';
import './v2/v2.css';

const el = document.getElementById('root');
if (!el) throw new Error('缺少 #root 挂载点');

const gallery = new URLSearchParams(window.location.search).has('gallery');

createRoot(el).render(<StrictMode>{gallery ? <Gallery /> : <AppV2 />}</StrictMode>);
