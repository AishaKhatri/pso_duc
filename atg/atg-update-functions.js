async function createTankCard(tank, gridContainer) {
    const config = fuelConfig[tank.product] || fuelConfig.PMG;

    const { card, titleContainer } = createCard(`Tank ${tank.tankId}`, `D${tank.address}`);

    card.setAttribute('data-tank-address', tank.address);

    // Main container for tank and level indicator
    const tankLevelContainer = document.createElement('div');
    Object.assign(tankLevelContainer.style, {
        display: 'flex',
        gap: '10px',
        flexDirection: 'row',
        marginTop: '15px',
    });

    // Tank container with realistic horizontal tank design
    const tankContainer = document.createElement('div');
    Object.assign(tankContainer.style, {
        position: 'relative',
        width: '360px',
        height: '200px',
        marginBottom: '5px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    });

    // Tank body (horizontal cylinder)
    const tankBody = document.createElement('div');
    Object.assign(tankBody.style, {
        position: 'relative',
        width: '350px',
        height: '180px',
        backgroundColor: '#eeeeee',
        borderRadius: '90px',
        border: '3px solid #666',
        overflow: 'hidden',
        boxShadow: 'inset 0 0 10px rgba(0,0,0,0.3), 0 6px 8px rgba(0, 0, 0, 0.1)'
    });

    // Fuel level
    const fuelLevel = document.createElement('div');
    const fillPercentage = Math.min((tank.filled / tank.capacity) * 100, 100);
    const fuelColor = config.header;
    
    Object.assign(fuelLevel.style, {
        position: 'absolute',
        bottom: '0',
        left: '0',
        width: '100%',
        height: `${fillPercentage}%`,
        backgroundColor: fuelColor,
        transition: 'height 0.5s ease',
        borderRadius: '10px'
    });

    // Create canvas for wave effect
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 350;
    canvas.height = 180;

    Object.assign(canvas.style, {
        position: 'absolute',
        bottom: '0',
        left: '0',
        width: '100%',
        height: '100%',
        borderRadius: '90px'
    });
    
    // Animate the wave
    let animationId;
    animateWave();
    
    // Store animation ID for cleanup if needed
    canvas.dataset.animationId = animationId;

    // Add canvas to tank body
    tankBody.appendChild(canvas);

    // Fuel level gradient for realism
    const fuelGradient = document.createElement('div');
    Object.assign(fuelGradient.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        background: `linear-gradient(to bottom, 
            rgba(255,255,255,0.3) 0%, 
            rgba(255,255,255,0.1) 50%, 
            rgba(0,0,0,0.2) 100%)`,
        borderRadius: '10px'
    });

    // Assemble tank
    tankBody.appendChild(fuelLevel);
    fuelLevel.appendChild(fuelGradient);
    tankContainer.appendChild(tankBody);

    // Tank info overlay
    const tankInfo = document.createElement('div');
    Object.assign(tankInfo.style, {
        position: 'absolute',
        top: '10px',
        left: '10px',
        right: '10px',
        textAlign: 'center',
        color: '#333',
        fontWeight: 'bold',
        fontSize: '12px',
        textShadow: '1px 1px 2px rgba(255,255,255,0.8)',
        zIndex: '2'
    });

    const fuelAmount = document.createElement('div');
    // fuelAmount.textContent = `${tank.filled.toFixed(1)} / ${tank.capacity} L`;
    fuelAmount.textContent = `${tank.filled.toFixed(1)} L`;
    fuelAmount.style.fontSize = '26px';
    fuelAmount.style.marginTop = '5px';

    tankInfo.appendChild(fuelAmount);
    tankContainer.appendChild(tankInfo);

    // Vertical ruler/indicator
    const verticalRuler = document.createElement('div');
    Object.assign(verticalRuler.style, {
        width: '20px',
        height: tankBody.style.height,
        backgroundColor: '#f8f9fa',
        border: '2px solid #666',
        borderRadius: '12px',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '5px 0',
        marginLeft: '55px',
        boxShadow: '2px 2px 8px rgba(0,0,0,0.1)'
    });

    // Create ruler markings
    for (let i = 0; i <= 10; i++) {
        const percentage = i * 10;
        const marker = document.createElement('div');
        marker.style.width = percentage % 20 === 0 ? '13px' : '8px';
        marker.style.height = '2px';
        marker.style.backgroundColor = '#666';
        marker.style.position = 'relative';
        
        // Add percentage labels for major markers
        if (percentage % 20 === 0) {
            const label = document.createElement('div');
            label.textContent = `${100 - percentage}%`;
            label.style.position = 'absolute';
            label.style.right = '20px';
            label.style.top = '-8px';
            label.style.fontSize = '10px';
            label.style.fontWeight = 'bold';
            label.style.color = '#333';
            label.style.padding = '1px 3px';
            label.style.borderRadius = '2px';
            marker.appendChild(label);
        }
        
        verticalRuler.appendChild(marker);
    }

    // Current level indicator
    const currentLevelMarker = document.createElement('div');
    const levelPosition = 100 - fillPercentage; // Invert since we start from top

    Object.assign(currentLevelMarker.style, {
        position: 'absolute',
        left: '-10px',
        top: `${levelPosition}%`,
        width: '12px',
        height: '12px',
        backgroundColor: config.header,
        border: '2px solid #fff',
        borderRadius: '50%',
        transform: 'translateY(-50%)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        zIndex: '10'
    });

    // Add arrow to current level marker
    const arrow = document.createElement('div');
    arrow.style.width = '0';
    arrow.style.height = '0';
    arrow.style.borderLeft = '6px solid transparent';
    arrow.style.borderRight = '6px solid transparent';
    arrow.style.borderTop = `6px solid ${config.header}`;
    arrow.style.position = 'absolute';
    arrow.style.left = '12px';
    arrow.style.top = '50%';
    arrow.style.transform = 'translateY(-50%)';

    currentLevelMarker.appendChild(arrow);
    verticalRuler.appendChild(currentLevelMarker);

    // Current level label
    const currentLevelLabel = document.createElement('div');
    currentLevelLabel.textContent = `${fillPercentage.toFixed(1)}%`;
    currentLevelLabel.style.position = 'absolute';
    currentLevelLabel.style.left = '-60px';
    currentLevelLabel.style.top = `${levelPosition}%`;
    currentLevelLabel.style.transform = 'translateY(-50%)';
    currentLevelLabel.style.backgroundColor = config.header;
    // currentLevelLabel.style.color = '#fff';
    currentLevelLabel.style.padding = '2px 6px';
    currentLevelLabel.style.borderRadius = '4px';
    currentLevelLabel.style.fontSize = '14px';
    currentLevelLabel.style.fontWeight = 'bold';
    currentLevelLabel.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';

    verticalRuler.appendChild(currentLevelLabel);

    // Assemble the tank and ruler
    tankLevelContainer.appendChild(verticalRuler);
    tankLevelContainer.appendChild(tankContainer);
    card.appendChild(tankLevelContainer);

    // Tank details section
    const detailsContainer = document.createElement('div');
    detailsContainer.style.marginTop = '10px';
    detailsContainer.style.padding = '15px 35px';
    // detailsContainer.style.paddingTop = '15px';
    detailsContainer.style.borderTop = '1px solid #ccc';
    detailsContainer.style.borderBottom = '1px solid #ccc';
    detailsContainer.style.display = 'grid';
    detailsContainer.style.gridTemplateColumns = '1fr 1fr';
    detailsContainer.style.gap = '5px 65px';

    detailsContainer.appendChild(showSensorData('Product', tank.filled.toFixed(1), 'L'));
    detailsContainer.appendChild(showSensorData('Temperature', tank.temperature.toFixed(1), '°C'));
    detailsContainer.appendChild(showSensorData('Water', tank.waterLevel.toFixed(1), 'L'));
    detailsContainer.appendChild(showSensorData('Status', tank.status, ''));
    detailsContainer.appendChild(showSensorData('Capacity', tank.capacity.toFixed(1), 'L'));

    card.appendChild(detailsContainer);

    // Add status footer
    const statusFooter = document.createElement('div');
    Object.assign(statusFooter.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        // marginTop: '15px',
        paddingTop: '15px',
        fontSize: '12px',
        color: '#666'
    });

    const activityStatus = document.createElement('div');
    activityStatus.className = 'atg-activity-status';
            
    // Style based on active status
    if (!tank.is_active) {
        activityStatus.textContent = 'Alert: ATG Inactive';
        activityStatus.style.fontWeight = 'bold';
        activityStatus.style.padding = '4px 8px';
        activityStatus.style.borderRadius = '4px';
        activityStatus.style.border = '2px solid #D32F2F'
        activityStatus.style.fontSize = '14px';
        activityStatus.style.color = '#D32F2F';
    } 

    const lastUpdated = document.createElement('div');
    lastUpdated.className = 'atg-last-updated';
    lastUpdated.style.fontSize = '14px';
    lastUpdated.style.alignItems = 'right';
    
    if (tank.last_updated) {
        const lastUpdateDate = new Date(tank.last_updated);
        const formattedTime = lastUpdateDate.toLocaleTimeString();
        const formattedDate = lastUpdateDate.toLocaleDateString();
        lastUpdated.textContent = `Last updated: ${formattedDate} ${formattedTime}`;
    } else {
        lastUpdated.textContent = 'Last updated: N/A';
    }
    
    statusFooter.appendChild(activityStatus);
    statusFooter.appendChild(lastUpdated);
    card.appendChild(statusFooter);

    // Low fuel warning
    if (fillPercentage < 30) {
        const lowFuelWarning = document.createElement('div');
        lowFuelWarning.textContent = '⚠️ Warning: Low Fuel Level!';
        Object.assign(lowFuelWarning.style, {
            position: 'relative',
            color: '#D32F2F',
            fontWeight: 'bold',
            fontSize: '22px',
            marginLeft: '5px',
            marginTop: '10px',
            textAlign: 'center'
        });
        // card.style.border = '2px solid #D32F2F';
        card.appendChild(lowFuelWarning);
    }

    gridContainer.appendChild(card);

    function animateWave() {
        drawWave();
        animationId = requestAnimationFrame(animateWave);
    }

    // Draw wave function
    function drawWave() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Calculate wave position based on fill percentage
        const waveHeight = canvas.height * (fillPercentage / 100);
        const waveY = canvas.height - waveHeight;
        
        // Create wave path
        ctx.beginPath();
        ctx.moveTo(0, waveY);
        
        // Generate random wave points
        const amplitude = 3; // Wave height
        const frequency = 0.02; // Wave width
        const segments = 50;
        
        for (let i = 0; i <= segments; i++) {
            const x = (i / segments) * canvas.width;
            // Random variation in the wave
            const randomVariation = Math.sin(i * frequency + Date.now() * 0.002) * amplitude;
            const y = waveY + randomVariation;
            ctx.lineTo(x, y);
        }
        
        // Close the path to fill the fuel area
        ctx.lineTo(canvas.width, canvas.height);
        ctx.lineTo(0, canvas.height);
        ctx.closePath();
        
        // Fill with fuel color
        ctx.fillStyle = fuelColor;
        ctx.fill();
        
        // Add some shine/reflection effect
        const gradient = ctx.createLinearGradient(0, waveY, 0, waveY + 30);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fill();
    }
}

function showSensorData (label, value, unit) {
    const infoContainer = document.createElement('div');
    infoContainer.style.display = 'flex';
    infoContainer.style.marginBottom = '5px';
    infoContainer.style.fontSize = '16px';
    // infoContainer.style.fontWeight = '500';
    infoContainer.style.gap = '5px';
    infoContainer.style.justifyContent = 'space-between';

    const labelEl = document.createElement('div');
    labelEl.textContent = `${label}:`;
    labelEl.style.color = '#333';

    const valueEl = document.createElement('div');
    valueEl.textContent = `${value} ${unit}`;
    valueEl.style.fontWeight = 'bold';
    valueEl.style.color = '#333';
    valueEl.style.textAlign = 'right';

    infoContainer.appendChild(labelEl);
    infoContainer.appendChild(valueEl);

    return infoContainer;
}