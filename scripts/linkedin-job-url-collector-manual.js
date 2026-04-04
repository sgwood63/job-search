// LinkedIn Job URL Collector - MANUAL ASSIST VERSION
// This captures the URL every time you click a new job
//
// How to use:
// 1. Open your LinkedIn job search results page
// 2. Open browser console (F12 or Cmd+Option+J)
// 3. Paste this script and press Enter
// 4. Click through jobs manually (or use arrow keys)
// 5. Script will capture each URL automatically
// 6. When done, type: downloadUrls() in console

(function() {
    console.log('🚀 LinkedIn Manual Job URL Collector Started');
    console.log('📋 Click through jobs - URLs will be captured automatically\n');
    console.log('⌨️  Tip: Use arrow keys (↓/↑) to navigate faster\n');
    console.log('💾 When done, type: downloadUrls()\n');
    console.log('='.repeat(60) + '\n');

    const urls = new Set();
    let lastUrl = window.location.href;
    let count = 0;

    // Extract job ID from URL
    function getJobIdFromUrl(url) {
        const match = url.match(/currentJobId=(\d+)|\/jobs\/view\/(\d+)/);
        return match ? (match[1] || match[2]) : null;
    }

    // Add current job if it's there
    const currentJobId = getJobIdFromUrl(window.location.href);
    if (currentJobId) {
        const cleanUrl = `https://www.linkedin.com/jobs/view/${currentJobId}`;
        urls.add(cleanUrl);
        count++;
        console.log(`✅ Job 1: ${currentJobId} (current)`);
    }

    // Watch for URL changes
    let checkInterval = setInterval(() => {
        const currentUrl = window.location.href;

        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            const jobId = getJobIdFromUrl(currentUrl);

            if (jobId) {
                const cleanUrl = `https://www.linkedin.com/jobs/view/${jobId}`;
                const sizeBefore = urls.size;
                urls.add(cleanUrl);

                if (urls.size > sizeBefore) {
                    count++;
                    console.log(`✅ Job ${count}: ${jobId}`);
                } else {
                    console.log(`   ↩️  Already captured: ${jobId}`);
                }
            }
        }
    }, 500); // Check every 500ms

    // Function to stop collecting and download
    window.downloadUrls = function() {
        clearInterval(checkInterval);

        console.log('\n' + '='.repeat(60));
        console.log(`\n📊 Collection complete! Found ${urls.size} unique job URLs\n`);

        if (urls.size === 0) {
            console.log('❌ No URLs captured. Make sure you clicked through some jobs.');
            return;
        }

        const urlList = Array.from(urls).sort();
        const urlText = urlList.join('\n');

        // Display URLs
        console.log('URLs captured:');
        urlList.forEach((url, index) => {
            console.log(`${index + 1}. ${url}`);
        });
        console.log('');

        // Download as file
        const blob = new Blob([urlText], { type: 'text/plain' });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        const timestamp = new Date().toISOString().split('T')[0];
        a.download = `linkedin-jobs-${timestamp}_${urls.size}-jobs.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        console.log('💾 URLs saved to downloads folder');

        // Copy to clipboard
        try {
            window.focus();
            navigator.clipboard.writeText(urlText).then(() => {
                console.log('📋 URLs copied to clipboard!');
                alert(`✅ Collection Complete!\n\nCaptured ${urls.size} job URLs\n\n📋 Copied to clipboard\n💾 Downloaded to file`);
            }).catch(() => {
                fallbackCopy(urlText, urls.size);
            });
        } catch (err) {
            fallbackCopy(urlText, urls.size);
        }
    };

    function fallbackCopy(urlText, size) {
        const textArea = document.createElement('textarea');
        textArea.value = urlText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();

        try {
            document.execCommand('copy');
            console.log('📋 URLs copied to clipboard (fallback method)!');
            alert(`✅ Collection Complete!\n\nCaptured ${size} job URLs\n\n📋 Copied to clipboard\n💾 Downloaded to file`);
        } catch (e) {
            alert(`✅ Collection Complete!\n\nCaptured ${size} job URLs\n\n💾 Downloaded to file\n\n⚠️ Copy URLs from console or file.`);
        }

        document.body.removeChild(textArea);
    }

    // Also provide a status function
    window.urlStatus = function() {
        console.log(`\n📊 Current status: ${urls.size} unique URLs captured`);
        if (urls.size > 0) {
            console.log('Most recent:');
            Array.from(urls).slice(-5).forEach((url, i) => {
                const jobId = url.match(/(\d+)$/)[1];
                console.log(`   ${jobId}`);
            });
        }
        console.log('');
    };

    console.log('✅ Collector running! Commands available:');
    console.log('   - downloadUrls() → Stop collecting and download/copy URLs');
    console.log('   - urlStatus() → Check how many URLs captured so far');
    console.log('');
})();
