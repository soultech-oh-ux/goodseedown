"""포터블 exe 에 내장할 번들 zip 을 만든다(결정적·'동기화 가능(rsyncable)' 압축).

배경: 차등 업데이트는 '이전 exe → 새 exe' 바이너리 패치(HDiffPatch)를 쓴다. 번들 zip 안의 큰 파일(Electron 본체
goodseedown.exe 약 250MB 등)이 deflate 로 한 덩어리 압축되어 있으면, 파일 앞쪽의 몇 바이트만 바뀌어도(버전 표기를 바꾸는
rcedit 가 PE 헤더·리소스를 바꾼다) 그 뒤 압축 결과 전체가 비트 단위로 밀려 패치가 100MB 가까이 커진다(실측).
해결: 큰 항목은 CHUNK 바이트마다 Z_FULL_FLUSH 를 넣어 압축한다. 그러면 각 덩어리의 압축 결과는 그 덩어리의 내용만으로
정해지고 바이트 경계에 맞춰지므로, 바뀐 덩어리만 달라지고 나머지는 바이트까지 같다. 결과는 표준 deflate 라 .NET ZipArchive 가
그대로 읽는다(압축률 손실은 약 1% 미만).

 - 같은 입력 → 같은 바이트(zlib level 6 고정). 항목 순서는 os.walk 순서, 항목 시간은 파일 수정시간.
 - 1MB 미만 항목은 단일 스트림(바뀌어도 어차피 작다).

사용: python -I make_bundle_zip.py <bundle 폴더> <출력 zip> [--replace <zip 안 경로>=<파일>]...
  --replace 는 시험용(예: resources/app.asar 만 바꾼 가짜 다음 버전 만들기).
"""
import os
import struct
import sys
import time
import zlib

CHUNK = 256 * 1024
BIG = 1024 * 1024
LEVEL = 6


def dos_datetime(mtime):
    t = time.localtime(mtime)
    year = max(1980, t.tm_year)
    return ((year - 1980) << 9 | t.tm_mon << 5 | t.tm_mday), (t.tm_hour << 11 | t.tm_min << 5 | t.tm_sec // 2)


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    root, out = argv[1], argv[2]
    replace = {}
    i = 3
    while i < len(argv):
        if argv[i] == '--replace' and i + 1 < len(argv):
            k, _, v = argv[i + 1].partition('=')
            replace[k] = v
            i += 2
        else:
            print('알 수 없는 인자:', argv[i])
            return 2
    if os.path.exists(out):
        os.remove(out)
    entries = []
    with open(out, 'wb') as fo:
        for d, _, fs in os.walk(root):
            for f in fs:
                p = os.path.join(d, f)
                arc = os.path.relpath(p, root).replace(os.sep, '/')
                src = replace.get(arc, p)
                size = os.path.getsize(src)
                ddate, dtime = dos_datetime(os.path.getmtime(p))
                raw = arc.encode('utf-8')
                flags = 0x800 if any(b > 127 for b in raw) else 0
                off = fo.tell()
                fo.write(struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, flags, 8, dtime, ddate, 0, 0, 0, len(raw), 0))
                fo.write(raw)
                comp = zlib.compressobj(LEVEL, zlib.DEFLATED, -15)
                crc = 0
                csize = 0
                big = size >= BIG
                with open(src, 'rb') as fi:
                    while True:
                        buf = fi.read(CHUNK)
                        if not buf:
                            break
                        crc = zlib.crc32(buf, crc)
                        data = comp.compress(buf)
                        if big:
                            data += comp.flush(zlib.Z_FULL_FLUSH)
                        if data:
                            fo.write(data)
                            csize += len(data)
                data = comp.flush(zlib.Z_FINISH)
                fo.write(data)
                csize += len(data)
                end = fo.tell()
                fo.seek(off + 14)
                fo.write(struct.pack('<III', crc & 0xFFFFFFFF, csize, size))
                fo.seek(end)
                entries.append((raw, flags, dtime, ddate, crc & 0xFFFFFFFF, csize, size, off))
        cd_start = fo.tell()
        for raw, flags, dtime, ddate, crc, csize, size, off in entries:
            fo.write(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, 20, 20, flags, 8, dtime, ddate, crc, csize, size, len(raw), 0, 0, 0, 0, 0, off))
            fo.write(raw)
        cd_end = fo.tell()
        if len(entries) >= 0xFFFF or cd_end >= 0xFFFFFFFF:
            raise SystemExit('ZIP64 가 필요한 크기입니다(미구현).')
        fo.write(struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, len(entries), len(entries), cd_end - cd_start, cd_start, 0))
    print(len(entries), os.path.getsize(out))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
