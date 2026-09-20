import {randomInt} from 'node:crypto'
import {deflateSync} from 'node:zlib'
// A fresh, local PNG challenge; no project files or remote assets are used.
function crc32(data:Buffer){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type:string,data:Buffer){const label=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([size,label,data,crc])}
export function visionChallenge(exclude=-1){let target=randomInt(16);while(target===exclude)target=randomInt(16);const size=224,raw=Buffer.alloc(size*(size*3+1),255)
 for(let y=0;y<size;y++){raw[y*(size*3+1)]=0;for(let x=0;x<size;x++){const col=Math.floor((x-12)/52),row=Math.floor((y-12)/52);if(x<12||y<12||col>3||row>3||(x-12)%52>=44||(y-12)%52>=44)continue;const offset=y*(size*3+1)+1+x*3;const color=row*4+col===target?[224,35,45]:[35,100,210];raw.set(color,offset)}}
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=2
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
 return {target,answer:'ABCD'[Math.floor(target/4)]+String(target%4+1),dataUrl:'data:image/png;base64,'+png.toString('base64')}
}
