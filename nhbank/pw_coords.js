// 원우님이 직접 맞춘 정밀 수치 적용
const CONFIG = {
    startX: 55,
    startY: 40,
    btnW: 33,
    btnH: 34,
    gap: 4
};

/**
 * @param {string} password - 사용자가 입력한 비밀번호 (예: "1234")
 * @param {Object} keypadMap - recognizeNumbers()의 결과 (예: {'pos_1_1.png': 8, ...})
 */
function getPasswordCoordinates(password, keypadMap) {
    const passwordCoords = [];
    const passwordChars = password.split('');

    // 1. 숫자별로 어느 위치(pos_r_c)에 있는지 역추적 맵 생성
    const numberToPos = {};
    for (const [pos, num] of Object.entries(keypadMap)) {
        if (num !== null) {
            numberToPos[num] = pos;
        }
    }

    // 2. 비밀번호 각 글자에 대해 좌표 계산
    passwordChars.forEach((char) => {
        const posName = numberToPos[parseInt(char)]; // 예: "pos_1_4"
        if (!posName) throw new Error(`숫자 ${char}를 키패드에서 찾을 수 없습니다.`);

        // 파일명에서 row와 col 추출 (예: pos_1_4 -> r=0, c=3)
        const match = posName.match(/pos_(\d)_(\d)/);
        const row = parseInt(match[1]) - 1;
        const col = parseInt(match[2]) - 1;

        // 중앙 좌표 계산
        const x = Math.floor(CONFIG.startX + (col * (CONFIG.btnW + CONFIG.gap)) + (CONFIG.btnW / 2));
        const y = Math.floor(CONFIG.startY + (row * (CONFIG.btnH + CONFIG.gap)) + (CONFIG.btnH / 2));

        passwordCoords.push({ char, x, y });
    });

    return passwordCoords;
}

// 테스트 실행 예시
const sampleMap = {
    'pos_1_1.png': 8, 'pos_1_2.png': 9, 'pos_1_3.png': 0, 'pos_1_4.png': 1,
    'pos_2_1.png': 7, 'pos_2_4.png': 2,
    'pos_3_1.png': 6, 'pos_3_4.png': 3,
    'pos_4_1.png': 5, 'pos_4_2.png': null, 'pos_4_3.png': null, 'pos_4_4.png': 4
};

const finalCoords = getPasswordCoordinates("2911", sampleMap);
console.log('--- 비밀번호 클릭 좌표 결과 ---');
finalCoords.forEach(c => console.log(`숫자 [${c.char}] 클릭 위치 -> X: ${c.x}, Y: ${c.y}`));