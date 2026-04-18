const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// 🌟 SECURE FIREBASE URL FROM GITHUB SECRETS 🌟
const FIREBASE_URL = process.env.FIREBASE_URL;

const orderStates = {}; 

// Function to fetch delivery prices from Firebase
async function getDeliveryPrice(address) {
    try {
        const response = await fetch(`${FIREBASE_URL}/deliveryPrices.json`);
        const priceData = await response.json();
        if (!priceData) return 50; // Default delivery fee
        
        // Match address to delivery zone and return dynamic price
        for (let zone in priceData) {
            if (address.toLowerCase().includes(zone.toLowerCase())) {
                return parseFloat(priceData[zone].price);
            }
        }
        return 50; // Default if no match
    } catch (error) {
        console.error("Failed to fetch delivery price:", error);
        return 50; // Default delivery fee on error
    }
}

// Function to fetch the dynamic menu from your App's Firebase
async function getMenuFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);
        const data = await response.json();
        if (!data) return[];
        
        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            price: data[key].price,
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        console.error("Failed to fetch menu:", error);
        return[];
    }
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL is missing in GitHub Secrets!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser:["S", "K", "1"] 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.clear(); 
            console.log('\n==================================================');
            console.log('⚠️ QR CODE TOO BIG? CLICK "View raw logs" in top right!');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true }); 
        }

        if (connection === 'open') console.log('✅ BongoProjukti AI IS ONLINE!');
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        // Skip group chats
        if (msg.key.remoteJid.includes('@g.us')) {
            console.log("⚠️ Group message ignored");
            return;
        }

        const sender = msg.key.remoteJid;
        
        // Safe text extraction
        let text = "";
        if (msg.message.conversation) {
            text = msg.message.conversation;
        } else if (msg.message.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text;
        }
        text = text.toLowerCase().trim();

        console.log(`📩 Query: ${text}`);

        // --- 🛒 STEP 2: FINISH ORDER & SEND TO ADMIN PANEL ---
        if (orderStates[sender]?.step === 'WAITING_FOR_ADDRESS') {
            const customerDetails = text;
            const item = orderStates[sender].item;
            const customerWaNumber = sender.split('@')[0];

            // Get dynamic delivery price based on address
            const deliveryPrice = await getDeliveryPrice(customerDetails);
            const totalPrice = (parseFloat(item.price) + deliveryPrice).toFixed(2);

            const BongoProjuktiOrder = {
                userId: "whatsapp_" + customerWaNumber,
                userEmail: "whatsapp@BongoProjukti.com",
                phone: customerWaNumber,
                address: customerDetails,
                location: { lat: 0, lng: 0 },
                items:[{
                    id: item.id,
                    name: item.name,
                    price: parseFloat(item.price),
                    img: item.imageUrl || "",
                    quantity: 1
                }],
                deliveryFee: deliveryPrice,
                total: totalPrice,
                status: "Placed",
                method: "Cash on Delivery (WhatsApp)",
                timestamp: new Date().toISOString()
            };

            try {
                await fetch(`${FIREBASE_URL}/orders.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(BongoProjuktiOrder)
                });
            } catch (error) {
                console.log("Firebase Error: ", error);
            }

            await sock.sendMessage(sender, { text: `✅ *Order Placed Successfully!* \n\nThank you! Your order for *${item.name}* is being prepared. \n\n🍔 *Item Price:* ₹${item.price}\n🚚 *Delivery Fee:* ₹${deliveryPrice}\n💰 *Total:* ₹${totalPrice}` });
            delete orderStates[sender]; 
            return;
        }

        // --- 🌟 STEP 1: START ORDER FLOW ---
        if (text.startsWith("order ")) {
            const productRequested = text.replace("order ", "").trim();
            const currentMenu = await getMenuFromApp();
            
            const matchedItem = currentMenu.find(item => item.name.toLowerCase().includes(productRequested));

            if (!matchedItem) {
                await sock.sendMessage(sender, { text: `❌ Sorry, we couldn't find *${productRequested}* in our menu today.\n\nType *menu* to see all available items.` });
                return;
            }

            orderStates[sender] = { step: 'WAITING_FOR_ADDRESS', item: matchedItem };
            
            const captionText = `🛒 *Order Started!* \n\nYou selected: *${matchedItem.name}* (₹${matchedItem.price})\n\nPlease reply with your *Full Name, Phone Number, and Delivery Address*.`;
            
            if (matchedItem.imageUrl) {
                await sock.sendMessage(sender, { 
                    image: { url: matchedItem.imageUrl }, 
                    caption: captionText 
                });
            } else {
                await sock.sendMessage(sender, { text: captionText });
            }
        }
        else if (text === "order") { 
            await sock.sendMessage(sender, { text: "🛒 *How to order:* \nPlease type 'order' followed by the dish name. \nExample: *order pizza*" });
        }
        
        // --- DYNAMIC MENU FEATURE ---
        else if (text.includes("menu") || text.includes("price") || text.includes("list") || text.includes("food")) {
            const currentMenu = await getMenuFromApp();
            
            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { text: "Our menu is currently empty or updating. Please check back soon!" });
                return;
            }

            let menuMessage = "🍔 *BongoProjukti LIVE MENU* 🍕\n\n";
            currentMenu.forEach(item => {
                menuMessage += `🔸 *${item.name}* - ₹${item.price}\n`;
            });
            menuMessage += "\n_To order, reply with 'order [dish name]'_";
            
            await sock.sendMessage(sender, { text: menuMessage });
        }

        // Case-insensitive greetings
        else if (text === "hi" || text === "hello" || text === "hey") {
            await sock.sendMessage(sender, { text: "👋 *Welcome to BongoProjukti!* \n\nI am your AI Assistant. Type *menu* to see our delicious food, or type *order [dish]* to buy instantly!" });
        }
        else if (text.includes("contact") || text.includes("call")) {
            await sock.sendMessage(sender, { text: "📞 *Contact BongoProjukti:* \n\n- *Email:* support@BongoProjukti.com" });
        }
        else {
            await sock.sendMessage(sender, { text: "🤔 I didn't quite catch that.\n\nType *menu* to see our food list, or *order [food]* to place an order!" });
        }
    });
}

startBot().catch(err => console.log("Error: " + err));
