const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch').default || require('pixelmatch');
const sharp = require('sharp');
const ERROR_LIMIT = 10; // 10픽셀 이상 차이 나면 숫자가 아니라고 판단

// 이미지 파일을 읽어 PNG 객체로 변환하는 함수
function readImage(path) {
    return new Promise((resolve) => {
        const img = fs.createReadStream(path).pipe(new PNG()).on('parsed', () => resolve(img));
    });
}

async function recognizeNumbers() {
    const sliceDir = './slices';
    const refDir = './refs';
    const slices = fs.readdirSync(sliceDir).filter(f => f.endsWith('.png'));
    const refs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    // 1. 정답지(Reference) 데이터 미리 로드
    const refImages = {};
    for (const num of refs) {
        refImages[num] = await readImage(`${refDir}/ref_${num}.png`);
    }

    console.log('--- 숫자 인식 시작 ---');
    const results = {};

    for (const sliceFile of slices) {
        const sliceImg = await readImage(`${sliceDir}/${sliceFile}`);
        let minDiff = Infinity;
        let recognizedNum = -1;

        // 2. 10개의 정답지와 하나씩 비교
        for (const num of refs) {
            const refImg = refImages[num];
            const diffCanvas = new PNG({ width: refImg.width, height: refImg.height });
            
            // 두 이미지 간의 차이 픽셀 수 계산
            const diffPixels = pixelmatch(
                sliceImg.data, refImg.data, diffCanvas.data, 
                refImg.width, refImg.height, { threshold: 0.1 }
            );

            if (diffPixels < minDiff) {
                minDiff = diffPixels;
                recognizedNum = num;
            }
        }

        if (minDiff > ERROR_LIMIT) {
            results[sliceFile] = null; // 또는 'EMPTY'
            console.log(`[${sliceFile}] 인식 결과: 알 수 없음 (빈 칸 혹은 로고)`);
        } else {
            results[sliceFile] = recognizedNum;
            console.log(`[${sliceFile}] 인식 결과: ${recognizedNum} (차이: ${minDiff}px)`);
        }
    }

    console.log('\n--- 최종 키패드 맵 ---');
    console.log(results);
    return results;
}

recognizeNumbers();