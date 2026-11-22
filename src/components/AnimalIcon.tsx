import type { ReactNode } from 'react';

export const animals = [
  { name: '小猫', color: '#e9b66f', background: '#fff1d9' },
  { name: '小狗', color: '#b68b69', background: '#f5e8dc' },
  { name: '兔子', color: '#f3d1ce', background: '#fff0ed' },
  { name: '小鱼', color: '#e6a579', background: '#fff0e3' },
  { name: '乌龟', color: '#94bca0', background: '#e9f3e9' },
  { name: '小鸭', color: '#ecd177', background: '#fff6ce' },
  { name: '大象', color: '#9bb8cb', background: '#e9f2fa' },
  { name: '熊猫', color: '#f4f2e9', background: '#eef0e8' },
  { name: '蝴蝶', color: '#b5a1ce', background: '#f2ecfa' },
  { name: '螃蟹', color: '#e99c8d', background: '#ffebe4' },
  { name: '蜗牛', color: '#c3ad79', background: '#f6efdd' },
  { name: '章鱼', color: '#c7a3bf', background: '#f8eaf4' },
  { name: '苹果', color: '#e57971', background: '#ffebe7' },
  { name: '香蕉', color: '#f2d36f', background: '#fff7d8' },
  { name: '葡萄', color: '#aa8bc5', background: '#f1eafa' },
  { name: '西瓜', color: '#ee918a', background: '#eaf4e5' },
  { name: '草莓', color: '#e8818b', background: '#ffedf0' },
  { name: '菠萝', color: '#e8bd63', background: '#fff3d8' },
  { name: '梨子', color: '#bfd17e', background: '#f2f6df' },
  { name: '樱桃', color: '#ce6976', background: '#fce9ed' },
  { name: '橙子', color: '#eeac60', background: '#fff0dd' },
  { name: '胡萝卜', color: '#e99b5b', background: '#fff0e0' },
  { name: '玉米', color: '#edcc68', background: '#fff8dc' },
  { name: '茄子', color: '#9c85b8', background: '#f0ebf7' },
  { name: '西兰花', color: '#86b28b', background: '#e9f3e6' },
  { name: '蘑菇', color: '#cb9076', background: '#f8ece3' },
  { name: '南瓜', color: '#e5a261', background: '#fff0dc' },
  { name: '甜椒', color: '#d98061', background: '#fcece0' },
];

const eyes = (x1 = 25, x2 = 40, y = 34) => <g fill="#364b40" stroke="none"><circle cx={x1} cy={y} r="2.6" /><circle cx={x2} cy={y} r="2.6" /></g>;

export function AnimalIcon({ kind, className = '' }: { kind: number; className?: string }) {
  const color = animals[kind].color;
  let drawing: ReactNode;
  switch (kind) {
    case 0:
      drawing = <><path d="M13 27 12 10 27 20Q32 18 37 20L52 10 51 28Q58 49 33 54 7 51 13 27Z" fill={color}/><path d="m16 17 8 5m23-5-7 5" stroke="#fff2d8" strokeWidth="3"/>{eyes()}<path d="m29 41 4 3 4-3M33 44v4m-15-7-8-1m8 7-8 2m38-8 8-1m-8 7 8 2"/></>;
      break;
    case 1:
      drawing = <><path d="M21 20Q11 12 7 24L9 42Q15 49 21 38M43 20Q53 12 57 24L55 42Q49 49 43 38" fill="#987153"/><path d="M18 24Q18 15 32 16 46 15 46 24L48 43Q45 55 32 55 19 55 16 43Z" fill={color}/><ellipse cx="32" cy="44" rx="12" ry="9" fill="#f8e9d4"/>{eyes(24,40,32)}<path d="M28 40h8l-4 5Z" fill="#364b40"/><path d="M32 45v5"/></>;
      break;
    case 2:
      drawing = <><path d="M20 28Q9 0 20 3 28 4 28 27m9 0Q38 1 47 4 55 9 44 29" fill={color}/><path d="m21 11 3 12m20-11-3 12" stroke="#c78785"/><ellipse cx="32" cy="40" rx="23" ry="17" fill="#ffefea"/>{eyes(23,41,37)}<path d="m29 43 3 3 3-3M32 46v4"/><path d="m17 44-5-1m35 1 5-1" stroke="#d3928f"/></>;
      break;
    case 3:
      drawing = <><path d="M43 25 58 14v36L43 39" fill="#df9568"/><path d="M5 32Q21 9 44 20L49 32 44 44Q21 55 5 32Z" fill={color}/><path d="M25 16 32 8 38 17m-13 31 8 8 5-10" fill="#e7bf77"/><circle cx="17" cy="30" r="3" fill="#364b40" stroke="none"/><path d="M27 23q6 10 0 18m8-15 6 6-6 6"/></>;
      break;
    case 4:
      drawing = <><path d="m17 43-6 10 10-1m18-9 6 10 6-5m-33-27-7-8 10 1m21 8 6-8 5 8" fill="#adcdb0"/><ellipse cx="52" cy="34" rx="9" ry="10" fill="#bdd7af"/><ellipse cx="29" cy="34" rx="21" ry="18" fill={color}/><path d="m26 22 12 6v12l-12 7-10-10 2-10Zm0 0-3-5m15 11 10-1M38 40l5 8M26 47l-1 5M16 37l-7 3"/><circle cx="55" cy="31" r="2.3" fill="#364b40" stroke="none"/></>;
      break;
    case 5:
      drawing = <><path d="M44 27q14-5 16 2l-15 6" fill="#de9765"/><path d="M29 30Q23 10 38 9q17 0 10 21v12Q40 59 20 51 7 46 7 32l14 4Z" fill={color}/><path d="M20 36q7 12 17 5"/><circle cx="39" cy="20" r="2.8" fill="#364b40" stroke="none"/><path d="M14 56h35" stroke="#8caea5"/></>;
      break;
    case 6:
      drawing = <><ellipse cx="16" cy="32" rx="12" ry="19" fill={color}/><ellipse cx="48" cy="32" rx="12" ry="19" fill={color}/><path d="M20 23q0-14 12-14t12 14v19l-7 2v9q-3 10-12 4l-2-5 8 1V40L20 42Z" fill="#bbced9"/>{eyes(26,39,29)}<path d="m21 41-3 7m24-7 3 7" stroke="#fffdf1" strokeWidth="4"/></>;
      break;
    case 7:
      drawing = <><circle cx="17" cy="16" r="10" fill="#4b5550"/><circle cx="47" cy="16" r="10" fill="#4b5550"/><ellipse cx="32" cy="35" rx="25" ry="22" fill={color}/><ellipse cx="21" cy="32" rx="7" ry="9" transform="rotate(25 21 32)" fill="#4b5550"/><ellipse cx="43" cy="32" rx="7" ry="9" transform="rotate(-25 43 32)" fill="#4b5550"/><g fill="white" stroke="none"><circle cx="23" cy="30" r="2.4"/><circle cx="41" cy="30" r="2.4"/></g><path d="m28 42 4 3 4-3M32 45v4"/></>;
      break;
    case 8:
      drawing = <><path d="M30 31Q6 0 5 21 4 40 26 36 3 43 15 55 29 61 32 38 36 61 49 55 61 43 38 36 60 40 59 21 58 0 34 31" fill={color}/><path d="M32 26v25m-1-27-7-13m9 13 7-13"/><circle cx="32" cy="26" r="4" fill="#605774"/><circle cx="17" cy="25" r="5" fill="#eadbec" stroke="none"/><circle cx="47" cy="25" r="5" fill="#eadbec" stroke="none"/></>;
      break;
    case 9:
      drawing = <><path d="m18 32-9-8m37 8 9-8M16 42 5 40m13 8L7 54m39-12 13-2M44 48l13 6"/><path d="M15 24Q3 29 3 16L9 7l2 10 8-5q8 12-4 12Zm34 0Q61 29 61 16L55 7l-2 10-8-5q-8 12 4 12Z" fill={color}/><ellipse cx="32" cy="40" rx="20" ry="14" fill={color}/><path d="M25 29v-8m14 8v-8"/>{eyes(25,39,20)}<path d="M27 43q5 5 10 0"/></>;
      break;
    case 10:
      drawing = <><path d="M8 46h34V31q0-8 8-8t8 8v13q0 12-16 12H13q-10 0-5-10Z" fill="#cbd3a0"/><circle cx="25" cy="34" r="20" fill={color}/><path d="M32 39q-14 10-17-3t11-13q10 3 3 11l-5-1m22-9-3-11m11 11 4-11"/>{eyes(43,58,11)}</>;
      break;
    case 11:
      drawing = <><path d="M15 34Q9 9 32 8t17 26q15 16 8 21-7 4-12-10 6 17-3 15-6-1-10-14-4 13-10 14-9 2-3-15-5 14-12 10-7-5 8-21Z" fill={color}/>{eyes(23,41,27)}<path d="M27 36q5 6 10 0"/></>;
      break;
    case 12:
      drawing = <>
        <path d="M32 21Q18 11 11 25 5 39 18 54q6 6 14 1 8 5 14-1 13-15 7-29-7-14-21-4Z" fill={color}/>
        <path d="M32 21q-3-8 2-15"/><path d="M35 15Q37 4 50 7q-3 11-15 8Z" fill="#8fb377"/>
        <path d="M18 28q-4 6-2 12" stroke="#ffe1d6" strokeWidth="4"/>
      </>;
      break;
    case 13:
      drawing = <>
        <path d="m45 14 1-8 7 2-2 10" fill="#b59860"/>
        <path d="M46 15Q40 44 10 40L6 45q23 25 43-1 10-14 2-28Z" fill={color}/>
        <path d="M12 46q26 9 36-23"/><path d="m6 45 4 4" strokeWidth="4"/>
        <path d="M21 48q10 0 17-7" stroke="#fff0ad" strokeWidth="3"/>
      </>;
      break;
    case 14:
      drawing = <>
        <path d="M32 19q-2-9 5-14"/><path d="M32 15Q18 1 12 14q10 9 20 1Z" fill="#8eb47c"/>
        <g fill={color}>
          <circle cx="24" cy="25" r="9"/><circle cx="41" cy="25" r="9"/>
          <circle cx="17" cy="39" r="9"/><circle cx="33" cy="39" r="9"/><circle cx="49" cy="39" r="9"/>
          <circle cx="25" cy="50" r="8"/><circle cx="41" cy="50" r="8"/><circle cx="33" cy="57" r="5"/>
        </g>
        <path d="m21 22 2-1m15 1 2-1m-24 15 2-1" stroke="#e9daf6" strokeWidth="3"/>
      </>;
      break;
    case 15:
      drawing = <>
        <path d="M6 20h52Q56 57 32 58 8 57 6 20Z" fill="#89b784"/>
        <path d="M10 20h44Q51 49 32 51 13 49 10 20Z" fill="#f4e5b0"/>
        <path d="M14 20h36Q47 44 32 46 17 44 14 20Z" fill={color}/>
        <path d="M22 27v3m20-3v3M32 25v4m-6 7 1 2m11-2-1 2" strokeWidth="3"/>
      </>;
      break;
    case 16:
      drawing = <>
        <path d="M12 22Q5 34 22 52q10 13 20 0 17-18 10-30-9-10-20-3-11-7-20 3Z" fill={color}/>
        <path d="M32 19V7m-1 11L19 10l2 12-11 1 15 7 7-7 7 7 15-7-11-1 2-12-12 8" fill="#8fb481"/>
        <path d="m18 33 1 2m12-4v3m13-1-1 2m-19 8 1 2m12-2-1 2m-4 6v2" stroke="#fff1c5" strokeWidth="3"/>
      </>;
      break;
    case 17:
      drawing = <>
        <path d="m23 24-9-15 13 6 5-12 5 12 13-6-9 15" fill="#91b17a"/>
        <path d="M32 21Q14 20 13 38q-1 22 19 22t19-22Q50 20 32 21Z" fill={color}/>
        <path d="m20 28 27 22M15 38l24 20M33 24l17 14M44 28 17 50m32-12L25 58M31 24 14 38" stroke="#9d804d" strokeWidth="2"/>
      </>;
      break;
    case 18:
      drawing = <>
        <path d="M24 23q0-10 8-10t8 10q0 9 10 18 12 18-18 19Q2 59 14 41q10-9 10-18Z" fill={color}/>
        <path d="M32 14q-1-7 4-10"/><path d="M35 12Q43 1 52 10q-7 9-17 2Z" fill="#82aa70"/>
        <path d="M22 38q-7 7-5 13" stroke="#eff2bc" strokeWidth="4"/>
        <path d="M29 54h6"/>
      </>;
      break;
    case 19:
      drawing = <>
        <path d="M19 39Q24 22 34 9q0 16 12 27" stroke="#6e925e" strokeWidth="3"/>
        <path d="M34 10Q19 1 13 12q9 9 21-2Z" fill="#93b77f"/>
        <path d="M19 34Q5 27 6 43q1 16 14 15 13-2 13-15 0-14-14-9Z" fill={color}/>
        <path d="M46 32Q33 25 33 41q0 15 13 15 13-1 13-15 0-15-13-9Z" fill={color}/>
        <path d="M13 39q-2 3-1 6m28-8q-2 3-1 6" stroke="#f8b8bb" strokeWidth="3"/>
      </>;
      break;
    case 20:
      drawing = <>
        <circle cx="32" cy="36" r="23" fill={color}/>
        <path d="M32 15V7m0 7Q39 1 52 8q-6 13-20 6Z" fill="#8aaf75"/>
        <path d="M18 24q-5 5-5 11" stroke="#ffdaa0" strokeWidth="4"/>
        <g fill="#ba793f" stroke="none"><circle cx="43" cy="44" r="1.7"/><circle cx="38" cy="49" r="1.7"/><circle cx="47" cy="37" r="1.7"/></g>
      </>;
      break;
    case 21:
      drawing = <>
        <path d="m39 23-6-15 9 5 5-10 2 12 12-2-12 15" fill="#8db57b"/>
        <path d="M36 21Q47 18 49 30 43 45 8 58 14 33 36 21Z" fill={color}/>
        <path d="m29 27 6 7m-16 3 6 6m12-4 5 3m-27 5 4 4"/>
      </>;
      break;
    case 22:
      drawing = <>
        <path d="M19 43V24Q19 6 32 6t13 18v19L32 58Z" fill={color}/>
        <path d="M27 12v32m10-32v32M20 21h24M19 30h26M20 39h24" stroke="#b39849" strokeWidth="2"/>
        <path d="M32 59Q8 54 8 28q15 6 24 25Q42 35 56 27q0 26-24 32Z" fill="#9bbd7b"/>
        <path d="M32 59 17 40m15 19 15-19"/>
      </>;
      break;
    case 23:
      drawing = <>
        <path d="M41 17Q57 22 49 40 40 61 15 58 1 56 10 43q6-7 12-8 12-3 12-16Z" fill={color}/>
        <path d="M37 20 29 20l8-8 8 2 9 11-11-2-4 7Z" fill="#8bae75"/>
        <path d="M42 15q2-8 9-10" strokeWidth="4"/>
        <path d="M17 47q14-1 21-12" stroke="#d6c5e8" strokeWidth="4"/>
      </>;
      break;
    case 24:
      drawing = <>
        <path d="m26 32-2 25q8 5 16 0l-2-25Z" fill="#b9ce8b"/>
        <path d="M31 48 19 34m14 10 12-12" stroke="#729260" strokeWidth="3"/>
        <path d="M14 37Q2 36 6 25q-1-12 12-11Q23 2 34 8 46 1 51 15q13 1 9 14-1 12-15 10-6 6-13 0-12 7-18-2Z" fill={color}/>
        <path d="M16 24q5-7 11-1m7-7q8-2 9 6m-6 8q6-5 11 0" stroke="#577d61"/>
      </>;
      break;
    case 25:
      drawing = <>
        <path d="m25 32-5 22q-1 6 12 6t12-6l-5-22" fill="#f3e6c8"/>
        <path d="M6 32Q8 7 32 7t26 25q-1 8-26 8T6 32Z" fill={color}/>
        <g fill="#fff0d8" stroke="none"><circle cx="21" cy="22" r="5"/><circle cx="39" cy="18" r="4"/><circle cx="46" cy="29" r="4"/><circle cx="31" cy="31" r="3"/></g>
        <path d="M29 44v9" stroke="#c9b88f"/>
      </>;
      break;
    case 26:
      drawing = <>
        <path d="m28 19 2-13 9-1-3 14" fill="#8ca574"/>
        <path d="M32 20Q15 10 8 25 0 42 14 54q8 7 18 2 10 5 18-2 14-12 6-29-7-15-24-5Z" fill={color}/>
        <path d="M26 21Q12 36 24 55m14-34q14 15 2 34M32 23v32" stroke="#9f7447"/>
        <path d="M37 14q12-9 17-1t-5 7" stroke="#7d9867"/>
      </>;
      break;
    case 27:
      drawing = <>
        <path d="M32 22Q17 10 10 26 6 37 16 54q6 8 16 2 10 6 16-2 10-17 6-28-7-16-22-4Z" fill={color}/>
        <path d="M23 22q9-8 18 0l-4-8H27Z" fill="#8aae76"/>
        <path d="M32 17q-2-10 5-12" stroke="#64875c" strokeWidth="5"/>
        <path d="M25 28q-5 12-1 23m16-23q5 12 0 23" stroke="#9e5949"/>
        <path d="M16 29q-2 6 0 11" stroke="#f6b99c" strokeWidth="3"/>
      </>;
      break;
    default:
      drawing = null;
  }
  return <svg className={`animal-icon ${className}`} viewBox="0 0 64 64" fill="none" stroke="#364b40" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawing}</svg>;
}
