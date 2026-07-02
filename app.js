const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// ⚙️ ตั้งค่าระบบ (ต้องเปลี่ยน Token และ User ID)
// ==========================================
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR18zg7epMhMALeGsrs2-galXbB_jcHZEDoPQaY9OIaNmzVJC1kZ1bsHQczMtA5cnxzclky79bkTeRv/pub?gid=1637010532&single=true&output=csv';
const LINE_ACCESS_TOKEN = '2ufFjG7lbXeF+z375jKBUwv9tyK9p09emb+o/+5f+uQnvU9UISBzoDMjflywDumlb2N7rpabtGCW7Jw9wi7LeMwlR7S4L0V5L8+xxqM6ho3KTmgjZktUFL3TVkpb2iuZYIgEL3Nh9pWO5pHXKzdXUQdB04t89/1O/w1cDnyilFU=';
const LINE_USER_ID = 'U9255911836e2c67c5ae3a52816a92e64';

// ฟังก์ชันดึงข้อมูลจาก Sheet
async function getSalesData() {
    try {
        const response = await axios.get(CSV_URL);
        const records = parse(response.data, { skip_empty_lines: true });

        // ดึงชื่อพนักงาน
        const emp1Name = records[40][3];  // คอลัมน์ D
        const emp2Name = records[40][11]; // คอลัมน์ L
        const emp3Name = records[40][19]; // คอลัมน์ T

        // วันที่ปัจจุบัน (เช่น 02/07/2026)
        const todayStr = moment().tz("Asia/Bangkok").format("DD/MM/YYYY");
        let targetRowIndex = -1;

        // ค้นหาแถวของวันนี้
        for (let i = 45; i < records.length; i++) {
            if (records[i] && records[i][2] === todayStr) {
                targetRowIndex = i;
                break;
            }
        }

        if (targetRowIndex === -1) {
            return { error: `ไม่พบข้อมูลของวันที่ ${todayStr} ในตาราง` };
        }

        return {
            date: todayStr,
            employees: [
                { name: emp1Name, sales: records[targetRowIndex][4] },
                { name: emp2Name, sales: records[targetRowIndex][12] },
                { name: emp3Name, sales: records[targetRowIndex][20] }
            ]
        };
    } catch (error) {
        console.error("ดึงข้อมูลล้มเหลว:", error.message);
        return { error: "เกิดข้อผิดพลาดในการดึงข้อมูลจาก Google Sheets" };
    }
}

// ฟังก์ชันส่งข้อความ LINE
async function sendLineMessage(msg) {
    const url = "https://api.line.me/v2/bot/message/push";
    const payload = {
        to: LINE_USER_ID,
        messages: [{ type: "text", text: msg }]
    };
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`
    };
    await axios.post(url, payload, { headers });
}

// ==========================================
// 🌐 1. หน้าเว็บ Dashboard สำหรับเข้ามาดูสถานะสดๆ
// ==========================================
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
        const isMissing = !emp.sales || String(emp.sales).trim() === "";
        const salesDisplay = isMissing ? "-" : Number(emp.sales).toLocaleString();
        const statusHtml = isMissing ? '<span class="status-missing">❌ ยังไม่ส่งยอด</span>' : '<span class="status-ok">✅ ส่งแล้ว</span>';
        html += `<tr><td>${emp.name}</td><td>${salesDisplay}</td><td>${statusHtml}</td></tr>`;
    });

    html += `</tbody></table></div></body></html>`;
    res.send(html);
});

// ==========================================
// 🤖 2. API สำหรับให้ระบบสะกิดตอน 21:30 น.
// ==========================================
app.get('/trigger-check', async (req, res) => {
    const data = await getSalesData();
    if (data.error) return res.status(500).send("Error: " + data.error);

    let missingList = [];
    data.employees.forEach(emp => {
        if (!emp.sales || String(emp.sales).trim() === "") {
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