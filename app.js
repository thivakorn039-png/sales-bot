const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// ⚙️ ตั้งค่าระบบ
// ==========================================
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRAbfdL4cir-rRD6cSoGVjPEaNEsfxiBiWRUHU176BjEF6e7TnRPMPkhbn0FyLX6eZ5JAEgyVIlVBIl/pub?output=csv';
const LINE_ACCESS_TOKEN = '2ufFjG7lbXeF+z375jKBUwv9tyK9p09emb+o/+5f+uQnvU9UISBzoDMjflywDumlb2N7rpabtGCW7Jw9wi7LeMwlR7S4L0V5L8+xxqM6ho3KTmgjZktUFL3TVkpb2iuZYIgEL3Nh9pWO5pHXKzdXUQdB04t89/1O/w1cDnyilFU=';
const LINE_USER_ID = 'U9255911836e2c67c5ae3a52816a92e64';

async function getSalesData() {
    try {
        const response = await axios.get(CSV_URL);
        const records = parse(response.data, { 
            skip_empty_lines: false,
            relax_quotes: true 
        });

        // แถวที่ 41 ใน Google Sheets จะตรงกับ index 40 ในระบบโค้ด
        const nameRow = records[40];
        if (!nameRow) {
            return { error: "ไม่พบข้อมูลในแถวที่ 41 ของตาราง" };
        }

        // ดึงชื่อพนักงานตามพิกัดเป๊ะๆ (A=0, B=1, C=2, D=3...)
        const emp1Name = nameRow[3] || "พนักงาน #1";  // คอลัมน์ D41
        const emp2Name = nameRow[11] || "พนักงาน #2"; // คอลัมน์ L41
        const emp3Name = nameRow[18] || "พนักงาน #3"; // คอลัมน์ S41

        // หาวันที่ปัจจุบันจากระบบ (รูปแบบ DD/MM/YYYY เช่น 03/07/2026)
        const todayStr = moment().tz("Asia/Bangkok").format("DD/MM/YYYY");
        let targetRowIndex = -1;

        // วนลูปค้นหาแถวของวันนี้ในคอลัมน์ C (index 2) เริ่มตั้งแต่วันที่ 1 แถวที่ 46 (index 45) จนถึงแถว 77
        for (let i = 45; i < records.length; i++) {
            if (!records[i] || !records[i][2]) continue;
            
            const sheetDateStr = records[i][2].trim();
            
            // ระบบแปลงข้อมูลเพื่อเปรียบเทียบตัวเลขวันที่ให้แม่นยำ (ป้องกันปัญหาฟอร์แมต 03/07 กับ 3/7 ไม่ตรงกัน)
            const pSheet = sheetDateStr.split('/');
            const pTarget = todayStr.split('/');
            
            if (pSheet.length === 3 && pTarget.length === 3) {
                if (parseInt(pSheet[0], 10) === parseInt(pTarget[0], 10) &&
                    parseInt(pSheet[1], 10) === parseInt(pTarget[1], 10) &&
                    parseInt(pSheet[2], 10) === parseInt(pTarget[2], 10)) {
                    targetRowIndex = i;
                    break;
                }
            }
        }

        if (targetRowIndex === -1) {
            return { error: `ไม่พบแถวข้อมูลของวันที่ ${todayStr} ในคอลัมน์ C ของตาราง` };
        }

        const targetRow = records[targetRowIndex];

        return {
            date: todayStr,
            employees: [
                { name: emp1Name, sales: targetRow[4] },  // คอลัมน์ E (ยอดขายคนที่ 1)
                { name: emp2Name, sales: targetRow[12] }, // คอลัมน์ M (ยอดขายคนที่ 2)
                { name: emp3Name, sales: targetRow[19] }  // คอลัมน์ T (ยอดขายคนที่ 3 จากช่วง T-Y)
            ]
        };
    } catch (error) {
        console.error("Error details:", error.message);
        return { error: `ระบบติดปัญหา: ${error.message}` };
    }
}

async function sendLineMessage(msg) {
    const url = "https://api.line.me/v2/bot/message/push";
    const payload = { to: LINE_USER_ID, messages: [{ type: "text", text: msg }] };
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`
    };
    await axios.post(url, payload, { headers });
}

// 🌐 หน้าเว็บ Dashboard สำหรับเข้าดูสถานะสดๆ
app.get('/', async (req, res) => {
    const data = await getSalesData();
    if (data.error) return res.send(`<h2>⚠️ ${data.error}</h2>`);

    let html = `
        <!DOCTYPE html>
        <html lang="th">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ตรวจสอบยอดขายรายวัน</title>
            <style>
                body { font-family: Tahoma, sans-serif; padding: 20px; background-color: #f8f9fa; color: #333; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                h2 { text-align: center; color: #0056b3; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
                th { background-color: #0056b3; color: white; }
                .status-ok { color: #28a745; font-weight: bold; }
                .status-missing { color: #dc3545; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>📊 สถานะการส่งยอดประจำวันที่ ${data.date}</h2>
                <table>
                    <thead><tr><th>ชื่อพนักงาน</th><th>ยอดขาย</th><th>สถานะ</th></tr></thead>
                    <tbody>
    `;

    data.employees.forEach(emp => {
        const isMissing = !emp.sales || String(emp.sales).trim() === "" || String(emp.sales).trim() === "0";
        const salesDisplay = isMissing ? "-" : Number(emp.sales).toLocaleString();
        const statusHtml = isMissing ? '<span class="status-missing">❌ ยังไม่ส่งยอด</span>' : '<span class="status-ok">✅ ส่งแล้ว</span>';
        html += `<tr><td>${emp.name}</td><td>${salesDisplay}</td><td>${statusHtml}</td></tr>`;
    });

    html += `</tbody></table></div></body></html>`;
    res.send(html);
});

// 🤖 สำหรับระบบสะกิดส่ง LINE OA ตอน 21:30 น.
app.get('/trigger-check', async (req, res) => {
    const data = await getSalesData();
    if (data.error) return res.status(500).send("Error: " + data.error);

    let missingList = [];
    data.employees.forEach(emp => {
        if (!emp.sales || String(emp.sales).trim() === "" || String(emp.sales).trim() === "0") {
            missingList.push(emp.name);
        }
    });

    let message = `\n📊 สรุปการส่งยอดประจำวันที่ ${data.date}\n`;
    if (missingList.length > 0) {
        message += "⚠️ รายชื่อพนักงานที่ยังไม่ส่งยอด (เวลา 21:30 น.):\n";
        missingList.forEach(name => message += `- ${name}\n`);
        message += "\nรบกวนอัปเดตยอดลงในระบบด้วยนะครับ/ค่ะ";
    } else {
        message += "🎉 พนักงานทุกคนส่งยอดเรียบร้อยแล้ว เยี่ยมมากครับ!";
    }

    try {
        await sendLineMessage(message);
        res.status(200).send("Checked and notified successfully!");
    } catch (err) {
        res.status(500).send("Failed to send LINE message");
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Web App is running on port ${PORT}`);
});
