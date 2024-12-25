
import React, { useState, useEffect } from 'react';
import './App.css';
import claimIcon from './assets/WW_Claim.svg';
import claimedIcon from './assets/WW_Claimed.svg';
import { ref, get, update } from 'firebase/database';
import { db } from '../firebase-config';
import Snowfall from 'react-snowfall'

interface Game {
  id: string;
  name: string;
  claimed: boolean;
  category: string;
  giftLink: string;
  verifying: boolean;
  imageUrl?: string;
  username: string;
  errorMessage?: string;
  claimedBy?: string;
}

function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [usernameVerification, setUsernameVerification] = useState<{ [key: string]: string }>({});
  const [filter, setFilter] = useState<'all' | 'claimed' | 'unclaimed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [shakeGameId, setShakeGameId] = useState<string | null>(null);
  const [uniqueCategories, setUniqueCategories] = useState<string[]>([]);

  useEffect(() => {
    const fetchFilteredGames = async () => {
      try {
        let gamesQuery = ref(db, 'games');
  
        // Apply query filters based on the `filter` and `categoryFilter`
        if (filter === 'claimed') {
          gamesQuery = query(ref(db, 'games'), orderByChild('claimed'), equalTo(true));
        } else if (filter === 'unclaimed') {
          gamesQuery = query(ref(db, 'games'), orderByChild('claimed'), equalTo(false));
        }
  
        // Fetch the filtered games from Firebase
        const snapshot = await get(gamesQuery);
  
        if (snapshot.exists()) {
          const data = snapshot.val();
          const updates: { [key: string]: any } = {};
  
          // Process games and fetch additional data if needed
          const gamesArray = await Promise.all(
            Object.keys(data).map(async (key) => {
              const game = data[key];
  
              // Ensure category is an array for consistency
              const normalizedCategory = Array.isArray(game.category) ? game.category : [game.category];
              updates[key] = { ...game, category: normalizedCategory };
              
              if (!game.username) {
                game.username = '';
              }
              // Fetch image URL if missing
              if (!game.imageUrl) {
                const imageUrl = await fetchImage(game.name + ' game cover');
                if (imageUrl) {
                  game.imageUrl = imageUrl;
                  updates[key]['imageUrl'] = imageUrl;
                }
              }
  
             
              // Fetch Steam link if missing
              if (!game.steamLink) {
                const steamLink = await fetchSteamLink(game.name);
                if (steamLink) {
                  game.steamLink = steamLink;
                  updates[key]['steamLink'] = steamLink;
                }
              }
  
              return { id: key, ...game, category: normalizedCategory };
            })
          );
  
          // Update Firebase with any new data (if image or Steam link was added)
          if (Object.keys(updates).some((key) => updates[key].imageUrl || updates[key].steamLink)) {
            update(ref(db, 'games'), updates);
          }
  
          // Apply the category filter (client-side filtering)
          const filteredGames = gamesArray.filter((game) => {
            if (categoryFilter !== 'all' && !game.category.some((cat) => cat.trim().toLowerCase() === categoryFilter.toLowerCase())) {
              return false;
            }
            return true;
          });
  
          setGames(filteredGames);
           // Calculate unique categories from the full games list
           const categories = Array.from(
            new Set(
              gamesArray.flatMap((game) =>
                Array.isArray(game.category)
                  ? game.category
                  : [game.category || "Uncategorized"]
              )
            )
          );
          setUniqueCategories(categories);
          
        } else {
          console.log('No games found.');
          setGames([]);
        }
      } catch (error) {
        console.error('Error fetching games data:', error);
      }
    };
  
    fetchFilteredGames();
  }, [filter, categoryFilter]); // Run whenever `filter` or `categoryFilter` changes
  

  const handleVerifyUsername = async (gameId: string, username: string | undefined) => {
    if (!username.trim()) {
      // Set error message and trigger shake effect
      setGames(games => games.map(game => 
        game.id === gameId 
          ? { ...game, errorMessage: "Please enter a valid username." } 
          : game
      ));
      setShakeGameId(gameId);
  
      // Remove the shake effect after the animation
      setTimeout(() => setShakeGameId(null), 500);
      return;
    }
  
    const usersRef = ref(db, 'users');
    const snapshot = await get(usersRef);
  
    if (snapshot.exists()) {
      const users = snapshot.val();
      const userKey = Object.keys(users).find(key => users[key].username === username);
      const user = userKey ? users[userKey] : null;
  
      if (user && user.ticketsAvailable > 0) {
        const gameName = games.find(game => game.id === gameId)?.name;
        if (gameName) {
          const newTicketCount = user.ticketsAvailable - 1;
          const newGamesClaimed = [...(user.gamesClaimed || []), gameName];
  
          await update(ref(db, `users/${userKey}`), { ticketsAvailable: newTicketCount, gamesClaimed: newGamesClaimed });
          updateGameAsClaimed(gameId, username);
        } else {
          setGames(games => games.map(game => 
            game.id === gameId 
              ? { ...game, errorMessage: "Game name not found for claiming." } 
              : game
          ));
          setShakeGameId(gameId);
          setTimeout(() => setShakeGameId(null), 500);
        }
      } else {
        setGames(games => games.map(game => 
          game.id === gameId 
            ? { ...game, errorMessage: "You do not have enough tickets to claim this game." } 
            : game
        ));
        setShakeGameId(gameId);
        setTimeout(() => setShakeGameId(null), 500);
      }
    } else {
      setGames(games => games.map(game => 
        game.id === gameId 
          ? { ...game, errorMessage: "Error fetching user data from the database." } 
          : game
      ));
      setShakeGameId(gameId);
      setTimeout(() => setShakeGameId(null), 500);
    }
  };
  const fetchSteamLink = async (gameName: string): Promise<string> => {
    const searchQuery = `${gameName} steam store`;
    const apiKey = '';
    const cx = ''; 
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(searchQuery)}&cx=${cx}&key=${apiKey}&num=1`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      return data.items && data.items.length > 0 ? data.items[0].link : '';
    } catch (error) {
      console.error('Failed to fetch Steam link', error);
      return '';
    }
  };
  const fetchImage = async (searchQuery: string): Promise<string> => {
    const apiKey = '';
    const cx = '';
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(searchQuery)}&cx=${cx}&key=${apiKey}&searchType=image&num=10`; // Requesting 10 results
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      // Filter results to find the first URL ending with .jpg, .jpeg, or .png
      const validImageUrl = data.items.find(item => /\.(jpg|jpeg|png)$/i.test(item.link));
      if (validImageUrl) {
        return validImageUrl.link;
      } else {
        console.log("No suitable image formats were found.");
        return ''; 
      }
    } catch (error) {
      console.error('Failed to fetch images', error);
      return '';
    }
  };
  const updateGameAsClaimed = (gameId: string, username: string) => {
    const gameRef = ref(db, `games/${gameId}`);
    update(gameRef, { claimed: true, claimedBy: username });
    setGames(games =>
      games.map(game =>
        game.id === gameId
          ? { ...game, claimed: true, verifying: false, errorMessage: '', claimedBy: username }
          : game
      )
    );
  };

  const setErrorMessage = (gameId: string, message: string) => {
    setGames(games => games.map(game => game.id === gameId ? { ...game, errorMessage: message } : game));
  };
  const handleUsernameChange = (id: string, value: string) => {
    setGames(games => games.map(game => game.id === id ? { ...game, username: value } : game));
  };

  const handleUsernameVerificationChange = (id: string, value: string) => {
    setUsernameVerification({ ...usernameVerification, [id]: value });
  };

  const isVerifiedUser = (game: Game) => {
    return game.claimedBy === usernameVerification[game.id];
  };
  const isNotVerifiedUser = (game: Game) => {
    return game.claimedBy != usernameVerification[game.id];
  };

  const filteredGames = games.filter((game) => {
    if (filter === "claimed" && !game.claimed) return false;
    if (filter === "unclaimed" && game.claimed) return false;
    if (
      categoryFilter !== "all" &&
      !game.category.some(
        (cat) => cat.trim().toLowerCase() === categoryFilter.toLowerCase()
      )
    )
      return false;
    return game.name.toLowerCase().includes(searchTerm.toLowerCase());
  });
  

  return (
    <div className="App" style={{ padding: '20px 0', textAlign: 'center', maxWidth: '1200px', margin: '0 auto', backgroundColor: '#121212', color: 'white' }}>
      <Snowfall />
      <br></br>
      <div style={{ position: 'fixed', top: -30, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '1200px', background: '#333', zIndex: 1000, textAlign: 'center', padding: '0px 0' }}>
        <h1>Wilbo's Free Games:</h1>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
          <input
            type="text"
            placeholder="Search by game name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ marginBottom: '20px', padding: '10px', width: '300px', borderRadius: '5px', border: '1px solid #555', backgroundColor: '#222', color: 'white' }}
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'claimed' | 'unclaimed')}
            style={{ marginBottom: '20px', padding: '10px', borderRadius: '5px', border: '1px solid #555', backgroundColor: '#222', color: 'white' }}
          >
            <option value="all">All Games</option>
            <option value="claimed">Claimed</option>
            <option value="unclaimed">Unclaimed</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ marginBottom: '20px', padding: '10px', borderRadius: '5px', border: '1px solid #555', backgroundColor: '#222', color: 'white' }}
          >
            <option value="all">All Categories</option>
            {uniqueCategories.map((category, index) => (
              <option key={index} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: '100px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-around', gap: '20px' }}>
       
        {filteredGames.map(game => (
          <div key={game.id} className={shakeGameId === game.id ? "shake" : ""} style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', maxWidth: '500px', flex: '1 1 40%', margin: '0 10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '15px', boxShadow: '0 4px 8px rgba(0,0,0,0.3)', borderRadius: '8px', width: '100%', backgroundColor: '#1a1a1a' }}>
              {game.imageUrl && <img src={game.imageUrl} alt={`${game.name} cover`} style={{ width: '300px', height: '300px', objectFit: 'cover', marginBottom: '15px' }} />}
              <span style={{ fontWeight: 'bold' }}>{game.name}</span>
              {game.category && (
                <p style={{ margin: '0px 0', color: '#888', fontSize: '14px' }}>
                  Categories: {game.category.join(', ')}
                </p>
              )}
              {game.steamLink && <a href={game.steamLink} target="_blank" rel="noopener noreferrer" style={{ marginTop: '10px' }}>Steam Store Page <img style={{ maxWidth:"12px"}} src="https://static-00.iconduck.com/assets.00/external-link-icon-2048x2048-wo7lfgrz.png"></img></a>}
              {!game.claimed && !game.verifying && (
                <>
                  <input type="text" value={game.username} onChange={(e) => handleUsernameChange(game.id, e.target.value)} placeholder="Enter your username" style={{ marginTop: '10px', padding: '12px', borderRadius: '5px', border: '1px solid #555', backgroundColor: '#222', color: 'white' }} />
                  <div style={{ position: 'relative', width: '100%', cursor: 'pointer', paddingTop: '19px' }} onClick={() => handleVerifyUsername(game.id, game.username)}>
                    <img src={claimIcon} alt="Claim" style={{ width: '100%' }} />
                    <span style={{ position: 'absolute', top: '40%', left: '45%', transform: 'translate(-50%, -50%)', color: '#9364B2', fontWeight: 'bold', fontSize: '24px' }}>Choose Gift</span>
                    <p style={{ marginTop: '10px', color: 'white' }}>Enter your username to use a ticket to claim this game!</p>
                  </div>
                </>
              )}
              {game.claimed && (
                <div style={{ position: 'relative', width: '100%', cursor: 'not-allowed', paddingTop: '19px' }}>
                  <img src={claimedIcon} alt="Gift Claimed!" style={{ width: '100%' }} />
                  <span style={{ position: 'relative', bottom:"77px", left: '20%', transform: 'translate(-50%, -50%)', color: '#9364B2', fontWeight: 'bold', fontSize: '24px' }}>Claimed!</span>
                  
                  <input
                    type="text"
                    value={usernameVerification[game.id] || ''}
                    onChange={(e) => handleUsernameVerificationChange(game.id, e.target.value)}
                    placeholder="Enter username used..."
                    style={{
                      marginTop: '10px',
                      padding: '12px',
                      borderRadius: '5px',
                      border: '1px solid #555',
                      backgroundColor: '#222',
                      color: 'white',
                      position: 'relative',
                      right: '46px'
                    }}
                  />
                  {isVerifiedUser(game) && game.giftLink && (
                    <p style={{ marginTop: '10px', color: 'white' }}><b>Game Code/Link:</b> {game.giftLink}</p>
                  )}
                  {isNotVerifiedUser(game) && game.giftLink && (
                    <p style={{ marginTop: '10px', color: 'white' }}>Lost your code? Enter the username you used above to claim it!</p>
                  )}
                </div>
              )}
              {game.errorMessage && <p style={{ color: 'red' }}>{game.errorMessage}</p>}
            </div>
          </div>
        ))}
      </div>
       <br></br>
    </div>
  );
}

export default App;
