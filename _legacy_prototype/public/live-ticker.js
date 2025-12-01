const tickerContent = document.getElementById('ticker-content');

async function fetchPrices() {
    try {
        // Using CoinGecko API (Free tier, rate limited)
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,ripple&vs_currencies=usd&include_24hr_change=true');
        const data = await response.json();

        let tickerHtml = '';

        for (const [coin, info] of Object.entries(data)) {
            const price = info.usd;
            const change = info.usd_24h_change.toFixed(2);
            const color = change >= 0 ? '#00e676' : '#ff4b4b';
            const arrow = change >= 0 ? '▲' : '▼';

            tickerHtml += `
                <span style="margin-right: 30px;">
                    <strong style="text-transform: uppercase; color: white;">${coin}</strong>: 
                    $${price.toLocaleString()} 
                    <span style="color: ${color};">(${arrow} ${change}%)</span>
                </span>
            `;
        }

        // Duplicate for infinite scroll effect if needed, but CSS animation handles loop
        tickerContent.innerHTML = tickerHtml + tickerHtml + tickerHtml;

    } catch (error) {
        console.error('Error fetching ticker data:', error);
        tickerContent.innerText = "Market Data Unavailable (API Limit Reached)";
    }
}

// Fetch immediately and then every 60 seconds
fetchPrices();
setInterval(fetchPrices, 60000);
