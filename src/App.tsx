/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, Users, UserMinus, BookOpen, Loader2, AlertCircle } from "lucide-react";

// --- Types ---

interface Clue {
  value: number;
  clue: string;
  answer: string;
  reference: string;
  verse: string;
  isUsed: boolean;
  isDailyDouble: boolean;
}

interface Category {
  name: string;
  clues: Clue[];
}

interface Player {
  name: string;
  score: number;
  isNew: boolean;
  type: 'individual' | 'team';
  members?: string[];
  currentMemberIndex?: number;
}

interface GameData {
  categories: Category[];
  finalJeopardy: {
    category: string;
    clue: string;
    answer: string;
    reference: string;
    verse: string;
  };
}

type GameState = 'landing' | 'setup' | 'loading' | 'playing' | 'daily-double-wager' | 'clue-reveal' | 'answer-reveal' | 'final-wager' | 'final-clue' | 'final-answer' | 'winner';

// --- Constants ---

const SACRED_CATEGORIES = [
  "Books of the Bible",
  "People of the Bible",
  "Prophets & Prophecy",
  "The Life of Jesus",
  "Parables of Jesus",
  "The Apostles & Early Church",
  "Psalms & Proverbs",
  "Death & Resurrection",
  "Numbers & Measurements"
];

export default function App() {
  const [gameState, setGameState] = useState<GameState>('landing');
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [activePlayerIndex, setActivePlayerIndex] = useState(0);
  const [selectedClue, setSelectedClue] = useState<{ catIndex: number; clueIndex: number } | null>(null);
  const [wager, setWager] = useState(200);
  const [finalWagers, setFinalWagers] = useState<number[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isJudging, setIsJudging] = useState(false);
  const [judgement, setJudgement] = useState<{ isCorrect: boolean; feedback: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalChampions, setFinalChampions] = useState<string[]>([]);
  const [demoVideoUrl, setDemoVideoUrl] = useState<string | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoStatus, setVideoStatus] = useState<string>('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  const generateDemoVideo = async () => {
    try {
      // @ts-ignore
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        // Assume success and proceed
      }

      setIsVideoLoading(true);
      setVideoStatus('Bishop Buzz is preparing the vision...');
      
      const ai = new GoogleGenAI({ apiKey: (process.env as any).API_KEY });
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: 'A charismatic older man with a grey beard and glasses, wearing a bishop\'s robe, hosting a high-energy game show called Bible Jeopardy in a grand, sun-lit cathedral with a giant game board.',
        config: {
          numberOfVideos: 1,
          resolution: '1080p',
          aspectRatio: '16:9'
        }
      });

      setVideoStatus('The AI is scribing the frames of truth...');

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
        setVideoStatus('Polishing the golden light of the arena...');
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: {
            'x-goog-api-key': (process.env as any).API_KEY,
          },
        });
        const blob = await response.blob();
        setDemoVideoUrl(URL.createObjectURL(blob));
      }
    } catch (err: any) {
      console.error('Video generation error:', err);
      if (err.message?.includes('Requested entity was not found')) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
      }
      setError('The vision was clouded. Please ensure your API key is valid and has billing enabled.');
    } finally {
      setIsVideoLoading(false);
      setVideoStatus('');
    }
  };

  // --- Gemini Integration ---

  const checkAnswer = async () => {
    if (!userInput || !currentClue) return;
    
    setIsJudging(true);
    setGameState('answer-reveal');
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `You are Bishop Buzz, the energetic Bible Jeopardy judge. 
        Clue: "${currentClue.clue}"
        Correct Answer: "${currentClue.answer}"
        User's Response: "${userInput}"
        
        Rules:
        1. The response MUST be in the form of a question (Who is/What is/etc).
        2. The substance must be correct based on the KJV Bible.
        
        Return strictly valid JSON: { "isCorrect": boolean, "feedback": "A short, enthusiastic Bishop Buzz reaction" }`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isCorrect: { type: Type.BOOLEAN },
              feedback: { type: Type.STRING }
            },
            required: ["isCorrect", "feedback"]
          }
        }
      });

      const result = JSON.parse(response.text);
      setJudgement(result);
    } catch (err) {
      console.error(err);
      setJudgement({ isCorrect: false, feedback: "The heavens are silent... I'll let you decide this one!" });
    } finally {
      setIsJudging(false);
    }
  };

  const generateGame = async (selectedDifficulty: 'easy' | 'medium' | 'hard' = difficulty) => {
    setGameState('loading');
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate a full Bible Jeopardy game based strictly on the King James Version (KJV).
        General Difficulty Level: ${selectedDifficulty.toUpperCase()}.
        Use these 9 categories: ${SACRED_CATEGORIES.join(", ")}.
        For each category, provide 5 clues with values 200, 400, 600, 800, 1000.
        Within the ${selectedDifficulty} level, difficulty must scale: 200 is easier, 1000 is harder.
        Also provide a Final Jeopardy category and clue.
        Return strictly valid JSON only.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              categories: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    clues: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          value: { type: Type.NUMBER },
                          clue: { type: Type.STRING },
                          answer: { type: Type.STRING },
                          reference: { type: Type.STRING },
                          verse: { type: Type.STRING }
                        },
                        required: ["value", "clue", "answer", "reference", "verse"]
                      }
                    }
                  },
                  required: ["name", "clues"]
                }
              },
              finalJeopardy: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING },
                  clue: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  reference: { type: Type.STRING },
                  verse: { type: Type.STRING }
                },
                required: ["category", "clue", "answer", "reference", "verse"]
              }
            },
            required: ["categories", "finalJeopardy"]
          }
        }
      });

      const data = JSON.parse(response.text) as GameData;
      
      // Add Daily Double
      const randomCat = Math.floor(Math.random() * 9);
      const randomClue = Math.floor(Math.random() * 5);
      data.categories[randomCat].clues[randomClue].isDailyDouble = true;

      setGameData(data);
      setGameState('playing');
    } catch (err) {
      console.error(err);
      setError("Hallelujah... we had a little trouble reaching the heavenly archives. Please try again!");
      setGameState('setup');
    }
  };

  // --- Game Actions ---

  const startSetup = (playerConfigs: { name: string; isNew: boolean; type: 'individual' | 'team'; members: string[] }[], selectedDifficulty: 'easy' | 'medium' | 'hard') => {
    setDifficulty(selectedDifficulty);
    setPlayers(playerConfigs.map(p => ({ 
      ...p, 
      score: 0, 
      currentMemberIndex: p.type === 'team' ? 0 : undefined 
    })));
    generateGame(selectedDifficulty);
  };

  const selectClue = (catIndex: number, clueIndex: number) => {
    if (gameData?.categories[catIndex].clues[clueIndex].isUsed) return;
    
    setSelectedClue({ catIndex, clueIndex });
    const clue = gameData!.categories[catIndex].clues[clueIndex];
    
    if (clue.isDailyDouble) {
      setGameState('daily-double-wager');
      setWager(Math.max(200, players[activePlayerIndex].score));
    } else {
      setGameState('clue-reveal');
    }
  };

  const handleAnswer = (correct: boolean) => {
    const value = selectedClue && gameData?.categories[selectedClue.catIndex].clues[selectedClue.clueIndex].isDailyDouble 
      ? wager 
      : (selectedClue ? gameData?.categories[selectedClue.catIndex].clues[selectedClue.clueIndex].value : 0);

    const newPlayers = [...players];
    const activePlayer = newPlayers[activePlayerIndex];

    if (correct) {
      activePlayer.score += value!;
    } else {
      activePlayer.score -= value!;
      // Switch player on wrong answer
      setActivePlayerIndex((activePlayerIndex + 1) % players.length);
    }

    // Rotate team member if it's a team
    if (activePlayer.type === 'team' && activePlayer.members) {
      activePlayer.currentMemberIndex = (activePlayer.currentMemberIndex! + 1) % activePlayer.members.length;
    }

    setPlayers(newPlayers);
    closeClue();
  };

  const closeClue = () => {
    if (selectedClue) {
      const newData = { ...gameData! };
      newData.categories[selectedClue.catIndex].clues[selectedClue.clueIndex].isUsed = true;
      setGameData(newData);
      
      // Check if game is over
      const allUsed = newData.categories.every(cat => cat.clues.every(clue => clue.isUsed));
      if (allUsed) {
        setGameState('final-wager');
      } else {
        setGameState('playing');
      }
    }
    setSelectedClue(null);
  };

  const submitFinalWager = (amount: number, playerIdx: number) => {
    const newWagers = [...finalWagers];
    newWagers[playerIdx] = amount;
    setFinalWagers(newWagers);
    
    if (newWagers.filter(w => w !== undefined).length === players.length) {
      setGameState('final-clue');
    }
  };

  const resolveFinal = (correct: boolean, playerIdx: number) => {
    const newPlayers = [...players];
    if (correct) {
      newPlayers[playerIdx].score += finalWagers[playerIdx];
    } else {
      newPlayers[playerIdx].score -= finalWagers[playerIdx];
    }
    setPlayers(newPlayers);
  };

  // --- Render Helpers ---

  if (gameState === 'landing') {
    return (
      <>
        <LandingPage onPlay={() => setGameState('setup')} onWatchDemo={generateDemoVideo} />
        <AnimatePresence>
          {isVideoLoading && <VideoLoadingModal status={videoStatus} />}
          {demoVideoUrl && <VideoModal url={demoVideoUrl} onClose={() => setDemoVideoUrl(null)} />}
        </AnimatePresence>
      </>
    );
  }

  if (gameState === 'setup') {
    return (
      <>
        <SetupScreen onStart={startSetup} error={error} />
        <AnimatePresence>
          {isVideoLoading && <VideoLoadingModal status={videoStatus} />}
          {demoVideoUrl && <VideoModal url={demoVideoUrl} onClose={() => setDemoVideoUrl(null)} />}
        </AnimatePresence>
      </>
    );
  }

  if (gameState === 'loading') {
    return <LoadingScreen />;
  }

  const currentClue = selectedClue ? gameData?.categories[selectedClue.catIndex].clues[selectedClue.clueIndex] : null;

  return (
    <div className="min-h-screen flex flex-col font-serif">
      {/* Header */}
      <header className="p-4 bg-black/30 border-b border-[#ffcc00]/30 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-[#ffcc00] italic flex items-center gap-2 drop-shadow-md">
          <BookOpen className="w-8 h-8" /> Bishop Buzz's Bible Jeopardy!
        </h1>
        <div className="flex gap-6">
          {players.map((p, i) => (
            <div key={i} className={`p-2 rounded border ${i === activePlayerIndex ? 'border-[#ffcc00] bg-[#ffcc00]/10' : 'border-white/20'}`}>
              <div className="text-[10px] uppercase tracking-widest opacity-70 flex items-center gap-2">
                {i === activePlayerIndex && <div className="w-1.5 h-1.5 rounded-full bg-[#ffcc00] animate-pulse" />}
                {p.name}
                {p.type === 'team' && p.members && (
                  <span className="ml-1 text-[#ffcc00]">
                    ({p.members[p.currentMemberIndex!]})
                  </span>
                )}
              </div>
              <div className={`text-xl font-bold ${p.score < 0 ? 'text-red-500' : 'text-[#ffcc00]'}`}>
                ${p.score.toLocaleString()}
              </div>
              {i === activePlayerIndex && (
                <div className="text-[8px] uppercase tracking-[0.2em] text-[#ffcc00] font-black mt-1">
                  Current Turn
                </div>
              )}
            </div>
          ))}
        </div>
      </header>

      {/* Main Board */}
      <main className="flex-1 jeopardy-grid overflow-auto">
        {gameData?.categories.map((cat, catIdx) => (
          <div key={catIdx} className="flex flex-col gap-2">
            <div className="bg-[#060ce9] border-2 border-black p-2 text-center font-bold text-[10px] h-20 flex items-center justify-center uppercase tracking-tighter leading-tight shadow-inner">
              {cat.name}
            </div>
            {cat.clues.map((clue, clueIdx) => (
              <div
                key={clueIdx}
                onClick={() => selectClue(catIdx, clueIdx)}
                className={`jeopardy-card ${clue.isUsed ? 'used' : ''}`}
              >
                {!clue.isUsed && (
                  <span className="text-[#ffcc00] text-3xl font-black drop-shadow-lg">${clue.value}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {gameState === 'daily-double-wager' && (
          <Modal>
            <div className="text-center space-y-6">
              <h2 className="text-6xl font-black daily-double-flash italic uppercase">DAILY DOUBLE!</h2>
              <p className="text-2xl">
                {players[activePlayerIndex].type === 'team' && players[activePlayerIndex].members 
                  ? `${players[activePlayerIndex].members[players[activePlayerIndex].currentMemberIndex!]} (${players[activePlayerIndex].name})`
                  : players[activePlayerIndex].name
                }, how much of your ${players[activePlayerIndex].score} are you willing to risk on the Word?
              </p>
              <div className="flex flex-col items-center gap-4">
                <input 
                  type="range" 
                  min="200" 
                  max={Math.max(1000, players[activePlayerIndex].score)} 
                  value={wager}
                  onChange={(e) => setWager(parseInt(e.target.value))}
                  className="w-full h-2 bg-[#ffcc00] rounded-lg appearance-none cursor-pointer"
                />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-[#ffcc00]">$</span>
                  <input 
                    type="number"
                    min="200"
                    max={Math.max(1000, players[activePlayerIndex].score)}
                    value={wager}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      const maxWager = Math.max(1000, players[activePlayerIndex].score);
                      setWager(Math.min(val, maxWager));
                    }}
                    className="bg-black/50 border-2 border-[#ffcc00] p-4 pl-10 rounded-xl text-4xl font-bold text-[#ffcc00] text-center w-64 outline-none focus:ring-2 ring-[#ffcc00]/50"
                  />
                </div>
                <button 
                  onClick={() => setGameState('clue-reveal')}
                  className="px-8 py-3 bg-[#ffcc00] text-black font-bold rounded-full hover:bg-white transition-colors"
                >
                  REVEAL THE CLUE!
                </button>
              </div>
            </div>
          </Modal>
        )}

        {gameState === 'clue-reveal' && currentClue && (
          <Modal>
            <div className="text-center space-y-8 max-w-4xl">
              <div className="text-[#ffcc00] uppercase tracking-widest text-xl">
                {gameData?.categories[selectedClue!.catIndex].name} - ${currentClue.value}
                {players[activePlayerIndex].type === 'team' && players[activePlayerIndex].members && (
                  <div className="flex flex-col items-center gap-1 mt-2">
                    <span className="text-white/70">
                      Turn: <span className="text-[#ffcc00] font-black">{players[activePlayerIndex].members[players[activePlayerIndex].currentMemberIndex!]}</span>
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[#ffcc00]/50 italic">
                      (You may consult with your brethren for help!)
                    </span>
                  </div>
                )}
              </div>
              
              <div className="space-y-4">
                <h2 className="text-5xl font-bold leading-tight uppercase drop-shadow-md">{currentClue.clue}</h2>
                {players[activePlayerIndex].isNew && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-[#ffcc00]/10 border border-[#ffcc00]/30 rounded-xl inline-block"
                  >
                    <div className="text-xs uppercase tracking-widest text-[#ffcc00] mb-1">Scriptural Assistance:</div>
                    <div className="text-2xl font-bold italic">Check {currentClue.reference}!</div>
                  </motion.div>
                )}
              </div>
              
              <div className="space-y-4">
                <div className="text-sm text-white/50 italic">Type your response (remember the form of a question!)</div>
                <input 
                  autoFocus
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && checkAnswer()}
                  placeholder="Who is... / What is..."
                  className="w-full bg-black/50 border-2 border-[#ffcc00]/30 p-4 rounded-xl text-2xl text-center outline-none focus:border-[#ffcc00] transition-colors"
                />
                <div className="flex justify-center gap-4">
                  <button 
                    onClick={checkAnswer} 
                    className="px-8 py-3 bg-[#ffcc00] text-black rounded-full font-bold hover:bg-white shadow-lg"
                  >
                    SUBMIT RESPONSE
                  </button>
                  <button 
                    onClick={() => { setUserInput(''); setGameState('answer-reveal'); }} 
                    className="px-8 py-3 bg-white/10 rounded-full font-bold hover:bg-white/20"
                  >
                    I DON'T KNOW
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        )}

        {gameState === 'answer-reveal' && currentClue && (
          <Modal>
            <div className="text-center space-y-6 max-w-4xl">
              <div className="text-[#ffcc00] text-2xl font-bold italic">Bishop Buzz says:</div>
              
              {isJudging ? (
                <div className="py-12 flex flex-col items-center gap-4">
                  <Loader2 className="w-16 h-16 text-[#ffcc00] animate-spin" />
                  <div className="text-3xl font-bold italic animate-pulse">Weighing your words in the balance...</div>
                </div>
              ) : (
                <>
                  {judgement && (
                    <motion.div 
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className={`p-6 rounded-2xl border-2 ${judgement.isCorrect ? 'bg-green-600/20 border-green-500' : 'bg-red-600/20 border-red-500'}`}
                    >
                      <div className={`text-4xl font-black italic mb-2 ${judgement.isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                        {judgement.isCorrect ? 'HALLELUJAH!' : 'ALAS...'}
                      </div>
                      <p className="text-xl italic">"{judgement.feedback}"</p>
                    </motion.div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <div className="space-y-4 p-6 bg-black/20 rounded-xl border border-white/10">
                      <div className="text-xs uppercase tracking-widest opacity-50">Your Scribed Response:</div>
                      <div className="text-3xl font-bold italic">
                        {userInput ? `"${userInput}"` : "--- No Response ---"}
                      </div>
                    </div>
                    <div className="space-y-4 p-6 bg-[#ffcc00]/10 rounded-xl border border-[#ffcc00]/20">
                      <div className="text-xs uppercase tracking-widest text-[#ffcc00]">The Heavenly Truth:</div>
                      <div className="text-3xl font-bold text-[#ffcc00]">
                        {currentClue.answer}
                      </div>
                    </div>
                  </div>

                  <div className="p-6 bg-white/10 rounded-xl border border-white/20 space-y-4">
                    <div className="text-[#ffcc00] font-bold text-xl">{currentClue.reference}</div>
                    <p className="text-2xl italic leading-relaxed">"{currentClue.verse}"</p>
                  </div>

                  <div className="space-y-4">
                    <div className="text-lg font-bold italic">
                      {judgement ? "Do you agree with the Bishop's judgment?" : "Was the response worthy of the points?"}
                    </div>
                    <div className="flex justify-center gap-4">
                      <button onClick={() => { handleAnswer(true); setUserInput(''); setJudgement(null); }} className="px-10 py-3 bg-green-600 rounded-full font-bold hover:bg-green-500 shadow-lg">YES, POINTS!</button>
                      <button onClick={() => { handleAnswer(false); setUserInput(''); setJudgement(null); }} className="px-10 py-3 bg-red-600 rounded-full font-bold hover:bg-red-500 shadow-lg">NO, DEDUCT</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Modal>
        )}

        {gameState === 'final-wager' && (
          <Modal>
             <div className="text-center space-y-8">
                <h2 className="text-6xl font-black text-[#ffcc00] italic uppercase">FINAL JEOPARDY!</h2>
                <div className="text-3xl uppercase tracking-widest">Category: {gameData?.finalJeopardy.category}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {players.map((p, i) => (
                    <div key={i} className="p-4 border border-white/20 rounded-lg bg-black/20 space-y-4">
                      <div className="font-bold">{p.name} (${p.score})</div>
                      
                      {p.type === 'team' && p.members && (
                        <div className="space-y-2">
                          <div className="text-xs uppercase text-[#ffcc00]">Select Champion:</div>
                          <select 
                            className="bg-black/50 border border-white/20 p-2 w-full rounded text-sm"
                            onChange={(e) => {
                              const newChamps = [...finalChampions];
                              newChamps[i] = e.target.value;
                              setFinalChampions(newChamps);
                            }}
                            value={finalChampions[i] || ''}
                          >
                            <option value="">Choose one...</option>
                            {p.members.map((m, idx) => (
                              <option key={idx} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <input 
                        type="number" 
                        placeholder="Wager" 
                        className="bg-black/50 border border-[#ffcc00] p-2 w-full text-center rounded"
                        onBlur={(e) => submitFinalWager(parseInt(e.target.value), i)}
                      />
                    </div>
                  ))}
                </div>
             </div>
          </Modal>
        )}

        {gameState === 'final-clue' && (
          <Modal>
            <div className="text-center space-y-8 max-w-4xl">
              <div className="text-[#ffcc00] uppercase tracking-widest text-xl">FINAL JEOPARDY</div>
              <h2 className="text-5xl font-bold leading-tight uppercase drop-shadow-md">{gameData?.finalJeopardy.clue}</h2>
              <button onClick={() => setGameState('final-answer')} className="px-12 py-4 bg-[#ffcc00] text-black font-bold rounded-full text-xl hover:bg-white shadow-xl">REVEAL ANSWER</button>
            </div>
          </Modal>
        )}

        {gameState === 'final-answer' && (
          <Modal>
            <div className="text-center space-y-6 max-w-4xl">
              <h2 className="text-5xl font-bold drop-shadow-md">{gameData?.finalJeopardy.answer}</h2>
              <div className="p-6 bg-white/10 rounded-xl border border-white/20 space-y-4">
                <div className="text-[#ffcc00] font-bold text-xl">{gameData?.finalJeopardy.reference}</div>
                <p className="text-2xl italic leading-relaxed">"{gameData?.finalJeopardy.verse}"</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {players.map((p, i) => (
                  <div key={i} className="flex flex-col gap-2 p-3 border border-white/10 rounded-lg">
                    <div className="text-xs uppercase text-[#ffcc00]">
                      {p.type === 'team' ? `${finalChampions[i]} (${p.name})` : p.name}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => resolveFinal(true, i)} className="flex-1 bg-green-600 p-2 rounded font-bold text-sm">Correct</button>
                      <button onClick={() => resolveFinal(false, i)} className="flex-1 bg-red-600 p-2 rounded font-bold text-sm">Wrong</button>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setGameState('winner')} className="px-12 py-4 bg-[#ffcc00] text-black font-bold rounded-full text-xl hover:bg-white shadow-xl">WHO WON?</button>
            </div>
          </Modal>
        )}

        {gameState === 'winner' && (
          <Modal>
            <div className="text-center space-y-8">
              <Trophy className="w-32 h-32 text-[#ffcc00] mx-auto drop-shadow-lg" />
              <h2 className="text-6xl font-black italic text-[#ffcc00] uppercase">WE HAVE A CHAMPION!</h2>
              <div className="text-8xl font-bold drop-shadow-xl">
                {players.reduce((prev, current) => (prev.score > current.score) ? prev : current).name}
              </div>
              <div className="text-4xl">With a score of ${players.reduce((prev, current) => (prev.score > current.score) ? prev : current).score.toLocaleString()}</div>
              <button onClick={() => window.location.reload()} className="px-12 py-4 bg-white text-black font-bold rounded-full text-xl hover:bg-[#ffcc00] transition-colors">PLAY AGAIN!</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

function LandingPage({ onPlay, onWatchDemo }: { onPlay: () => void; onWatchDemo: () => void }) {
  const [activeTab, setActiveTab] = useState<'vision' | 'arena' | 'pillars' | 'fellowship'>('vision');

  const tabs = [
    { id: 'vision', label: 'The Vision', icon: <Trophy className="w-5 h-5" /> },
    { id: 'arena', label: 'The Arena', icon: <Users className="w-5 h-5" /> },
    { id: 'pillars', label: 'The Pillars', icon: <BookOpen className="w-5 h-5" /> },
    { id: 'fellowship', label: 'Fellowship', icon: <Users className="w-5 h-5" /> },
  ] as const;

  return (
    <div className="min-h-screen bg-[#060ce9] flex flex-col items-center overflow-x-hidden selection:bg-[#ffcc00] selection:text-[#060ce9]">
      {/* Hero Section */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative w-full h-screen flex flex-col items-center justify-center text-center p-6 gap-12"
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1],
              rotate: [0, 5, 0],
              opacity: [0.1, 0.2, 0.1]
            }}
            transition={{ duration: 20, repeat: Infinity }}
            className="absolute -top-1/2 -left-1/4 w-[150%] h-[150%] bg-gradient-to-br from-[#ffcc00] via-transparent to-transparent rounded-full blur-[120px]"
          />
        </div>

        <div className="relative z-10 space-y-4">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", damping: 12 }}
            className="w-40 h-40 bg-[#ffcc00] rounded-[2.5rem] flex items-center justify-center mx-auto shadow-[0_20px_60px_rgba(255,204,0,0.4)] border-8 border-white/20"
          >
            <BookOpen className="w-24 h-24 text-[#060ce9]" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="inline-block px-6 py-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-[#ffcc00] font-bold text-sm uppercase tracking-[0.4em]"
          >
            The Authorized Arena
          </motion.div>
        </div>
        
        <h1 className="text-[12vw] font-black text-[#ffcc00] italic uppercase tracking-tighter drop-shadow-[0_20px_20px_rgba(0,0,0,0.5)] leading-[0.8] relative z-10">
          Bishop Buzz's <br/> 
          <span className="text-white drop-shadow-none">Bible</span> <br/>
          Jeopardy!
        </h1>
        
        <div className="space-y-6 max-w-4xl mx-auto relative z-10">
          <p className="text-4xl italic text-white font-black leading-tight drop-shadow-md">
            "The Arena of Truth awaits! Are your lamps trimmed and burning?"
          </p>
          <p className="text-xl text-white/70 leading-relaxed font-medium max-w-2xl mx-auto">
            Step out of the darkness and into the golden light of scriptural scholarship. Whether you are a seasoned theologian or a curious seeker, the Word is ready to be revealed in the most energetic arena on this side of the Jordan!
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-6 justify-center items-center relative z-10">
          <motion.button 
            whileHover={{ scale: 1.05, boxShadow: "0 0 60px rgba(255,204,0,0.6)" }}
            whileTap={{ scale: 0.95 }}
            onClick={onPlay}
            className="px-24 py-10 bg-[#ffcc00] text-[#060ce9] font-black text-5xl rounded-full shadow-2xl hover:bg-white transition-all uppercase tracking-widest border-8 border-white/10 relative overflow-hidden group"
          >
            <span className="relative z-10">ENTER THE ARENA!</span>
            <motion.div 
              className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"
            />
          </motion.button>

          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onWatchDemo}
            className="px-12 py-6 bg-white/10 text-white font-black text-2xl rounded-full shadow-xl hover:bg-white/20 transition-all uppercase tracking-widest border-4 border-white/10 backdrop-blur-md"
          >
            WATCH THE VISION
          </motion.button>
        </div>

        <motion.div 
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/30"
        >
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.5em] font-bold">Scroll to Explore</span>
            <div className="w-px h-12 bg-gradient-to-b from-white/30 to-transparent" />
          </div>
        </motion.div>
      </motion.div>

      {/* Tabbed Navigation */}
      <div className="sticky top-0 z-40 w-full bg-[#060ce9]/80 backdrop-blur-2xl border-b border-white/10 py-4 px-6 flex justify-center overflow-x-auto no-scrollbar">
        <div className="flex bg-black/40 p-1.5 rounded-full border border-white/10 gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-3 px-8 py-3 rounded-full text-sm font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id 
                  ? 'bg-[#ffcc00] text-[#060ce9] shadow-lg' 
                  : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Sections */}
      <div className="w-full max-w-7xl px-6 py-32 min-h-screen">
        <AnimatePresence mode="wait">
          {activeTab === 'vision' && (
            <motion.div
              key="vision"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-32"
            >
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
                <div className="space-y-8">
                  <div className="inline-block px-4 py-1 bg-[#ffcc00] text-[#060ce9] font-bold text-xs uppercase tracking-[0.3em] rounded-md">The Voice of the Word</div>
                  <h2 className="text-7xl font-black text-[#ffcc00] italic uppercase leading-none">Meet <br/> Bishop Buzz</h2>
                  <div className="space-y-6 text-xl text-white/80 leading-relaxed font-medium">
                    <p>
                      "I've spent fifty years—half a century, saints!—scribing the margins of my Authorized King James Bible. From the dusty plains of Genesis to the crystal seas of Revelation, I have hunted for the hidden gems of truth."
                    </p>
                    <p>
                      Bishop Buzz isn't just a judge; he's a fellow traveler. His mission is to turn the "study" into a "celebration." He believes that the Word of God is quick, powerful, and—dare we say—incredibly exciting when put into the arena of competition!
                    </p>
                    <p className="text-[#ffcc00] italic">
                      "A workman that needeth not to be ashamed, rightly dividing the word of truth."
                    </p>
                  </div>
                  <div className="flex gap-8 pt-4">
                    <div className="flex flex-col">
                      <span className="text-5xl font-black text-[#ffcc00]">50+</span>
                      <span className="text-xs uppercase tracking-widest text-white/40">Years of Study</span>
                    </div>
                    <div className="w-px h-16 bg-white/10"></div>
                    <div className="flex flex-col">
                      <span className="text-5xl font-black text-[#ffcc00]">100%</span>
                      <span className="text-xs uppercase tracking-widest text-white/40">KJV Accurate</span>
                    </div>
                    <div className="w-px h-16 bg-white/10"></div>
                    <div className="flex flex-col">
                      <span className="text-5xl font-black text-[#ffcc00]">1611</span>
                      <span className="text-xs uppercase tracking-widest text-white/40">The Standard</span>
                    </div>
                  </div>
                </div>
                <div className="relative group">
                  <div className="absolute -inset-8 bg-[#ffcc00]/20 blur-3xl rounded-[4rem] group-hover:bg-[#ffcc00]/30 transition-all"></div>
                  <div className="relative aspect-[4/5] rounded-[4rem] overflow-hidden border-8 border-[#ffcc00]/40 shadow-2xl">
                    <img 
                      src="https://picsum.photos/seed/bishop-study/1200/1500" 
                      alt="Bishop Buzz's Study" 
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-1000 scale-110 group-hover:scale-100"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#060ce9] via-transparent to-transparent opacity-80"></div>
                    <div className="absolute bottom-12 left-12 right-12 space-y-4">
                      <div className="w-12 h-1 bg-[#ffcc00]" />
                      <p className="text-white font-black italic text-3xl leading-tight">"The gold of that land is good..."</p>
                      <p className="text-white/60 text-sm uppercase tracking-widest">Genesis 2:12</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="text-center space-y-12 py-20 bg-black/20 rounded-[4rem] border border-white/5 p-20">
                <div className="max-w-4xl mx-auto space-y-8">
                  <h2 className="text-6xl font-black text-[#ffcc00] italic uppercase">The King's English</h2>
                  <p className="text-3xl text-white leading-relaxed font-black italic">
                    "Why the King James Version? Because the Word deserves the weight of majesty!"
                  </p>
                  <p className="text-xl text-white/60 leading-relaxed font-medium">
                    Every clue and every verse in this arena is pulled strictly from the **Authorized 1611 King James Version**. We celebrate the "thees," the "thous," and the rhythmic beauty that has echoed through cathedrals and homes for over 400 years. It is the gold standard of the English language and the heart of Bishop Buzz's study.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-12 pt-12">
                    <div className="p-8 bg-white/5 rounded-3xl border border-white/10">
                      <div className="text-[#ffcc00] text-5xl font-black mb-2">1611</div>
                      <div className="text-xs uppercase tracking-[0.3em] text-white/40 font-bold">Authorized Year</div>
                    </div>
                    <div className="p-8 bg-white/5 rounded-3xl border border-white/10">
                      <div className="text-[#ffcc00] text-5xl font-black mb-2">400+</div>
                      <div className="text-xs uppercase tracking-[0.3em] text-white/40 font-bold">Years of Majesty</div>
                    </div>
                    <div className="p-8 bg-white/5 rounded-3xl border border-white/10">
                      <div className="text-[#ffcc00] text-5xl font-black mb-2">KJV</div>
                      <div className="text-xs uppercase tracking-[0.3em] text-white/40 font-bold">The Standard</div>
                    </div>
                  </div>
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'arena' && (
            <motion.div
              key="arena"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-20"
            >
              <div className="text-center space-y-4 mb-20">
                <h2 className="text-8xl font-black text-[#ffcc00] italic uppercase">The Law of the Arena</h2>
                <p className="text-2xl text-white/60 italic">"Rightly dividing the word of truth in the heat of competition."</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="p-12 bg-white rounded-[3rem] text-[#060ce9] space-y-8 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#060ce9]/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700" />
                  <div className="text-7xl font-black opacity-10 italic">01</div>
                  <h3 className="text-4xl font-black italic uppercase leading-none">The Question <br/> Clause</h3>
                  <p className="text-xl font-medium opacity-80 leading-relaxed">
                    "Remember the ancient form! Every response must be scribed as a question. 'Who is...' or 'What is...'—fail this, and even the correct truth will be rejected by the Bishop!"
                  </p>
                  <div className="pt-8 border-t border-[#060ce9]/10">
                    <p className="text-sm font-bold uppercase tracking-widest opacity-40 italic">Penalty: Loss of clue value</p>
                  </div>
                </div>

                <div className="p-12 bg-white rounded-[3rem] text-[#060ce9] space-y-8 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#060ce9]/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700" />
                  <div className="text-7xl font-black opacity-10 italic">02</div>
                  <h3 className="text-4xl font-black italic uppercase leading-none">The Ledger <br/> of Points</h3>
                  <p className="text-xl font-medium opacity-80 leading-relaxed">
                    "Correctness brings wealth to your score, but error brings a heavy debt. Choose your values wisely—the 1000-point clues are for the true scholars of the Word!"
                  </p>
                  <div className="pt-8 border-t border-[#060ce9]/10">
                    <p className="text-sm font-bold uppercase tracking-widest opacity-40 italic">Values: 200 to 1000</p>
                  </div>
                </div>

                <div className="p-12 bg-white rounded-[3rem] text-[#060ce9] space-y-8 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#060ce9]/5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700" />
                  <div className="text-7xl font-black opacity-10 italic">03</div>
                  <h3 className="text-4xl font-black italic uppercase leading-none">The Daily <br/> Double</h3>
                  <p className="text-xl font-medium opacity-80 leading-relaxed">
                    "A test of faith! Risk what you have gained to multiply your blessing. It is the only time you can wager your entire score on a single truth."
                  </p>
                  <div className="pt-8 border-t border-[#060ce9]/10">
                    <p className="text-sm font-bold uppercase tracking-widest opacity-40 italic">Hidden on the board</p>
                  </div>
                </div>
              </div>

              <div className="bg-black/40 p-20 rounded-[4rem] border-4 border-[#ffcc00] relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-10">
                  <Trophy className="w-64 h-64 text-[#ffcc00]" />
                </div>
                <div className="relative z-10 max-w-3xl space-y-8">
                  <div className="inline-block px-4 py-1 bg-[#ffcc00] text-[#060ce9] font-bold text-xs uppercase tracking-[0.3em] rounded-md">The Final Test</div>
                  <h3 className="text-7xl font-black text-[#ffcc00] italic uppercase leading-none">Final <br/> Jeopardy!</h3>
                  <p className="text-2xl text-white italic leading-relaxed font-medium">
                    "When the board is clear, only one challenge remains. A single category, a single clue, and a final wager. This is where champions are crowned and legends are scribed in the heavenly archives!"
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-8">
                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10">
                      <h4 className="text-[#ffcc00] font-bold uppercase text-sm mb-2">The Wager</h4>
                      <p className="text-white/60 text-sm italic">Wager any amount up to your current score before seeing the clue.</p>
                    </div>
                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10">
                      <h4 className="text-[#ffcc00] font-bold uppercase text-sm mb-2">The Champion</h4>
                      <p className="text-white/60 text-sm italic">Teams must select their most learned champion to answer the final call.</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'pillars' && (
            <motion.div
              key="pillars"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-20"
            >
              <div className="text-center space-y-4">
                <h2 className="text-8xl font-black text-[#ffcc00] italic uppercase tracking-tight">The Nine Sacred Pillars</h2>
                <p className="text-2xl text-white/60 max-w-3xl mx-auto italic">"Every game is built upon these foundations of wisdom, covering the breadth of the Authorized Version."</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {SACRED_CATEGORIES.map((cat, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    viewport={{ once: true }}
                    className="p-10 bg-white/5 border-2 border-white/10 rounded-[3rem] hover:bg-[#ffcc00] hover:border-[#ffcc00] transition-all group relative overflow-hidden"
                  >
                    <div className="absolute -right-4 -top-4 text-white/5 font-black text-9xl group-hover:text-black/10 transition-colors">0{i+1}</div>
                    <div className="relative z-10 space-y-4">
                      <h3 className="text-3xl font-black text-white group-hover:text-black transition-colors uppercase italic leading-none">{cat}</h3>
                      <p className="text-lg text-white/50 group-hover:text-black/70 transition-colors leading-relaxed italic font-medium">
                        {i === 0 && "From the Law of Moses to the history of Israel's kings and the building of the Temple."}
                        {i === 1 && "The giants of faith, the humble servants, and the villains whose stories warn us today."}
                        {i === 2 && "The voices that cried in the wilderness and the visions of things to come in the latter days."}
                        {i === 3 && "The miracles, the ministry, and the majesty of the Son of Man from Bethlehem to Calvary."}
                        {i === 4 && "Earthly stories with heavenly meanings, spoken by the Master to reveal the Kingdom."}
                        {i === 5 && "The fire of Pentecost, the journeys of Paul, and the expansion of the first believers."}
                        {i === 6 && "The songs of David that comfort the soul and the wisdom of Solomon that guides the mind."}
                        {i === 7 && "The ultimate victory over the grave, the empty tomb, and the hope of the world's return."}
                        {i === 8 && "The divine order hidden in the measurements of the Tabernacle and the counts of the tribes."}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'fellowship' && (
            <motion.div
              key="fellowship"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-32"
            >
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="bg-black/40 p-16 rounded-[4rem] border-4 border-[#ffcc00]/30 space-y-10 relative overflow-hidden group">
                  <div className="absolute -right-20 -bottom-20 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Users className="w-96 h-96 text-[#ffcc00]" />
                  </div>
                  <div className="p-6 bg-[#ffcc00] rounded-3xl w-fit shadow-xl">
                    <Users className="w-12 h-12 text-[#060ce9]" />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-6xl font-black text-[#ffcc00] italic uppercase leading-none">The Holy Team <br/> Dynamics</h3>
                    <p className="text-2xl text-white/70 leading-relaxed font-medium">
                      "Gather the brethren! Up to five souls can join a single team. You shall rotate on every clue, ensuring that no one hides their light under a bushel."
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {[
                      "Auto-rotation of members",
                      "Collaborative bidding logic",
                      "Team-based scoring",
                      "Shared wisdom strategy"
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-center gap-4 text-white/80 p-4 bg-white/5 rounded-2xl border border-white/10">
                        <div className="w-3 h-3 rounded-full bg-[#ffcc00] shadow-[0_0_10px_rgba(255,204,0,0.5)]" />
                        <span className="font-bold uppercase tracking-widest text-xs">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="bg-white/5 p-16 rounded-[4rem] border-4 border-white/10 space-y-10 relative overflow-hidden group">
                  <div className="absolute -right-20 -bottom-20 opacity-5 group-hover:opacity-10 transition-opacity">
                    <BookOpen className="w-96 h-96 text-white" />
                  </div>
                  <div className="p-6 bg-white rounded-3xl w-fit shadow-xl">
                    <BookOpen className="w-12 h-12 text-[#060ce9]" />
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-6xl font-black text-white italic uppercase leading-none">The Seeker's <br/> Sanctuary</h3>
                    <p className="text-2xl text-white/70 leading-relaxed font-medium">
                      "Never opened the Word? Bishop Buzz welcomes you with open arms! Toggle the 'New to the Word' mode to receive a scriptural lamp."
                    </p>
                  </div>
                  <div className="space-y-6">
                    <p className="text-lg text-white/50 italic">
                      We provide the reference for every clue, so you can flip through your Bible and find the truth in real-time. It's not just a game; it's a discovery!
                    </p>
                    <div className="p-8 bg-black/30 rounded-3xl border-2 border-white/10 space-y-4">
                      <p className="text-sm text-[#ffcc00] font-black uppercase tracking-[0.3em]">Digital Bible Access:</p>
                      <p className="text-lg text-white/60 italic leading-relaxed">
                        "No physical Bible? Use <a href="https://www.biblegateway.com" target="_blank" className="text-white underline hover:text-[#ffcc00] transition-colors">BibleGateway.com</a> or the YouVersion app to follow along with our KJV references!"
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="bg-[#ffcc00] p-20 rounded-[4rem] text-[#060ce9] text-center space-y-12 shadow-[0_40px_100px_rgba(255,204,0,0.2)]">
                <div className="max-w-3xl mx-auto space-y-6">
                  <h2 className="text-7xl font-black italic uppercase leading-none tracking-tighter">Ready to Test <br/> Your Lamp?</h2>
                  <p className="text-2xl font-black italic opacity-80">
                    "Choose your difficulty, gather your friends, and let the Word be revealed!"
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-8">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 bg-[#060ce9] rounded-2xl flex items-center justify-center shadow-lg">
                      <Trophy className="w-8 h-8 text-[#ffcc00]" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Compete</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 bg-[#060ce9] rounded-2xl flex items-center justify-center shadow-lg">
                      <BookOpen className="w-8 h-8 text-[#ffcc00]" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Learn</span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 bg-[#060ce9] rounded-2xl flex items-center justify-center shadow-lg">
                      <Users className="w-8 h-8 text-[#ffcc00]" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest">Fellowship</span>
                  </div>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Final CTA */}
      <section className="w-full max-w-7xl px-6 pb-40 text-center space-y-16">
        <div className="space-y-4">
          <motion.div
            animate={{ y: [0, -20, 0] }}
            transition={{ duration: 4, repeat: Infinity }}
          >
             <Trophy className="w-48 h-48 text-[#ffcc00] mx-auto drop-shadow-[0_0_50px_rgba(255,204,0,0.5)]" />
          </motion.div>
          <h2 className="text-[10vw] font-black text-white italic uppercase leading-none tracking-tighter">The Arena Calls!</h2>
          <p className="text-3xl text-white/40 italic font-medium">"Will you be found worthy of the crown of wisdom?"</p>
        </div>
        <motion.button 
          whileHover={{ scale: 1.1, boxShadow: "0 0 80px rgba(255,204,0,0.4)" }}
          whileTap={{ scale: 0.9 }}
          onClick={onPlay}
          className="px-32 py-12 bg-[#ffcc00] text-[#060ce9] font-black text-6xl rounded-full shadow-[0_30px_60px_rgba(0,0,0,0.6)] hover:bg-white transition-all uppercase tracking-widest border-8 border-white/10"
        >
          PLAY NOW!
        </motion.button>
      </section>

      <footer className="mt-auto py-20 text-center space-y-8 border-t border-white/10 w-full max-w-7xl px-6">
        <div className="flex flex-wrap justify-center gap-16 text-[12px] uppercase tracking-[0.5em] text-white/20 font-black">
          <span className="hover:text-[#ffcc00] transition-colors cursor-default">KJV Authorized</span>
          <span className="hover:text-[#ffcc00] transition-colors cursor-default">Bishop Buzz Approved</span>
          <span className="hover:text-[#ffcc00] transition-colors cursor-default">Saints & Seekers Welcome</span>
        </div>
        <p className="text-white/40 text-lg italic max-w-3xl mx-auto leading-relaxed font-medium">
          "Study to shew thyself approved unto God, a workman that needeth not to be ashamed, rightly dividing the word of truth." <br/>
          <span className="text-[#ffcc00]/40">— 2 Timothy 2:15</span>
        </p>
        <div className="pt-12 opacity-20 hover:opacity-100 transition-opacity">
          <BookOpen className="w-12 h-12 text-white mx-auto" />
        </div>
      </footer>
    </div>
  );
}

function VideoLoadingModal({ status }: { status: string }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="text-center space-y-8 max-w-md">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          className="w-24 h-24 border-4 border-[#ffcc00] border-t-transparent rounded-full mx-auto"
        />
        <div className="space-y-2">
          <h3 className="text-3xl font-black text-[#ffcc00] italic uppercase">Preparing the Vision</h3>
          <p className="text-white/70 italic text-lg">{status}</p>
        </div>
        <p className="text-white/40 text-sm">This may take a few minutes as the AI scribes the arena...</p>
      </div>
    </motion.div>
  );
}

function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        className="w-full max-w-5xl aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl relative border-4 border-[#ffcc00]/30"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-black/50 text-white rounded-full hover:bg-white hover:text-black transition-colors"
        >
          <UserMinus className="w-6 h-6" />
        </button>
        <video 
          src={url} 
          controls 
          autoPlay 
          className="w-full h-full object-contain"
        />
      </motion.div>
    </motion.div>
  );
}

function SetupScreen({ onStart, error }: { onStart: (playerConfigs: { name: string; isNew: boolean; type: 'individual' | 'team'; members: string[] }[], difficulty: 'easy' | 'medium' | 'hard') => void; error: string | null }) {
  const [configs, setConfigs] = useState<{ name: string; isNew: boolean; type: 'individual' | 'team'; members: string[] }[]>([
    { name: '', isNew: false, type: 'individual', members: [] },
    { name: '', isNew: false, type: 'individual', members: [] }
  ]);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');

  const addMember = (playerIdx: number) => {
    const newConfigs = [...configs];
    if (newConfigs[playerIdx].members.length < 5) {
      newConfigs[playerIdx].members.push('');
      setConfigs(newConfigs);
    }
  };

  const updateMember = (playerIdx: number, memberIdx: number, value: string) => {
    const newConfigs = [...configs];
    newConfigs[playerIdx].members[memberIdx] = value;
    setConfigs(newConfigs);
  };

  const removeMember = (playerIdx: number, memberIdx: number) => {
    const newConfigs = [...configs];
    newConfigs[playerIdx].members = newConfigs[playerIdx].members.filter((_, idx) => idx !== memberIdx);
    setConfigs(newConfigs);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#060ce9]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl w-full bg-black/40 p-8 rounded-3xl border-2 border-[#ffcc00]/50 backdrop-blur-xl space-y-8 shadow-2xl overflow-auto max-h-[90vh]"
      >
        <div className="text-center space-y-2">
          <Trophy className="w-16 h-16 text-[#ffcc00] mx-auto drop-shadow-md" />
          <h1 className="text-5xl font-black italic text-[#ffcc00] drop-shadow-lg uppercase tracking-tighter">The Arena Registry</h1>
          <p className="text-white/70 italic text-xl">"Study to shew thyself approved unto God, a workman that needeth not to be ashamed..."</p>
          <div className="w-24 h-1 bg-[#ffcc00] mx-auto mt-4" />
        </div>

        {error && (
          <div className="p-4 bg-red-500/20 border border-red-500 rounded-lg flex items-center gap-3 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-6">
          {configs.map((config, i) => (
            <div key={i} className="space-y-4 p-6 bg-white/5 rounded-2xl border border-white/10">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <label className="text-[10px] uppercase tracking-widest text-[#ffcc00]">Player {i + 1}</label>
                  <div className="flex bg-black/40 rounded-full p-1 border border-white/10">
                    <button 
                      onClick={() => {
                        const newConfigs = [...configs];
                        newConfigs[i].type = 'individual';
                        setConfigs(newConfigs);
                      }}
                      className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${config.type === 'individual' ? 'bg-[#ffcc00] text-black' : 'text-white/50'}`}
                    >
                      Individual
                    </button>
                    <button 
                      onClick={() => {
                        const newConfigs = [...configs];
                        newConfigs[i].type = 'team';
                        if (newConfigs[i].members.length === 0) newConfigs[i].members = ['', ''];
                        setConfigs(newConfigs);
                      }}
                      className={`px-3 py-1 rounded-full text-[10px] uppercase font-bold transition-all ${config.type === 'team' ? 'bg-[#ffcc00] text-black' : 'text-white/50'}`}
                    >
                      Team
                    </button>
                  </div>
                </div>
                {configs.length > 1 && (
                  <button 
                    onClick={() => setConfigs(configs.filter((_, idx) => idx !== i))}
                    className="text-red-400 hover:text-red-300 transition-colors"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                )}
              </div>

              <input 
                value={config.name}
                onChange={(e) => {
                  const newConfigs = [...configs];
                  newConfigs[i].name = e.target.value;
                  setConfigs(newConfigs);
                }}
                placeholder={config.type === 'team' ? "Team Name" : "Enter Name"}
                className="w-full bg-black/30 border border-white/20 p-3 rounded-lg focus:border-[#ffcc00] outline-none text-white transition-colors"
              />

              {config.type === 'team' && (
                <div className="space-y-3 pl-4 border-l-2 border-[#ffcc00]/30">
                  <div className="text-[10px] uppercase text-white/40">Team Members (Max 5)</div>
                  {config.members.map((member, mIdx) => (
                    <div key={mIdx} className="flex gap-2">
                      <input 
                        value={member}
                        onChange={(e) => updateMember(i, mIdx, e.target.value)}
                        placeholder={`Member ${mIdx + 1}`}
                        className="flex-1 bg-black/20 border border-white/10 p-2 rounded text-sm outline-none focus:border-[#ffcc00]"
                      />
                      {config.members.length > 2 && (
                        <button onClick={() => removeMember(i, mIdx)} className="text-red-400/50 hover:text-red-400">
                          <UserMinus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {config.members.length < 5 && (
                    <button 
                      onClick={() => addMember(i)}
                      className="text-[10px] text-[#ffcc00] hover:underline"
                    >
                      + Add Member
                    </button>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer group">
                <input 
                  type="checkbox"
                  checked={config.isNew}
                  onChange={(e) => {
                    const newConfigs = [...configs];
                    newConfigs[i].isNew = e.target.checked;
                    setConfigs(newConfigs);
                  }}
                  className="w-4 h-4 accent-[#ffcc00]"
                />
                <span className="text-xs text-white/60 group-hover:text-white transition-colors">New to the Word (Show references)</span>
              </label>
            </div>
          ))}
          <button 
            onClick={() => setConfigs([...configs, { name: '', isNew: false, type: 'individual', members: [] }])}
            className="text-sm text-[#ffcc00] hover:underline flex items-center gap-1"
          >
            <Users className="w-4 h-4" /> Add another player/team
          </button>
        </div>

        <div className="space-y-4 p-6 bg-white/5 rounded-2xl border border-white/10">
          <div className="flex flex-col items-center gap-2 mb-2">
            <label className="text-[10px] uppercase tracking-[0.4em] text-[#ffcc00] font-black">The Weight of the Word</label>
            <p className="text-[10px] text-white/40 italic">"Choose the depth of your scriptural challenge"</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {(['easy', 'medium', 'hard'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setDifficulty(level)}
                className={`py-3 rounded-xl font-bold uppercase tracking-widest transition-all border-2 ${
                  difficulty === level 
                    ? 'bg-[#ffcc00] text-black border-[#ffcc00] shadow-[0_0_20px_rgba(255,204,0,0.3)]' 
                    : 'bg-black/40 text-white/50 border-white/10 hover:border-white/30'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/40 italic text-center">
            {difficulty === 'easy' && "Gentle waters for the young in faith."}
            {difficulty === 'medium' && "A balanced path for the diligent seeker."}
            {difficulty === 'hard' && "The narrow gate for the true scriptural scholar."}
          </p>
        </div>

        <button 
          onClick={() => onStart(configs, difficulty)}
          className="w-full py-4 bg-[#ffcc00] text-black font-bold rounded-full text-xl hover:bg-white transition-all shadow-lg shadow-[#ffcc00]/20 active:scale-95"
        >
          ENTER THE TABERNACLE!
        </button>
      </motion.div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center space-y-8 bg-[#060ce9]">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="w-24 h-24 text-[#ffcc00]" />
      </motion.div>
      <div className="text-center space-y-4">
        <h2 className="text-4xl font-bold italic text-[#ffcc00] animate-pulse drop-shadow-lg">Consulting the Heavenly Archives...</h2>
        <p className="text-xl text-white/60 italic">"For the word of God is quick, and powerful..."</p>
      </div>
    </div>
  );
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 modal-overlay flex items-center justify-center p-6"
    >
      <motion.div 
        initial={{ scale: 0.8, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.8, y: 20 }}
        className="bg-[#060ce9] border-4 border-[#ffcc00] p-12 rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-auto"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
