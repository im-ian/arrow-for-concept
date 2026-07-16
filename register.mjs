// node --import ./register.mjs <entry> 로 실행하면 .xjs import 가 동작
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
